/**
 * Journal entry tool handlers
 */

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { FoundryClient } from '../../foundry/client.js';
import type { WorldJournal } from '../../foundry/types.js';
import { htmlToText } from '../../utils/html-to-text.js';
import { withToolError } from './utils.js';

export async function handleSearchJournals(
  args: { query: string; limit?: number },
  foundryClient: FoundryClient,
) {
  return withToolError('search journals', async () => {
    const results = foundryClient.searchJournals(args.query);
    const limit = args.limit || 10;
    const limited = results.slice(0, limit);

    if (limited.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No journals found matching "${args.query}".`,
          },
        ],
      };
    }

    const formatted = limited
      .map((j) => {
        const pageCount = j.pages?.length || 0;
        return `- **${j.name}** (${pageCount} page${pageCount !== 1 ? 's' : ''}) — ID: ${j._id}`;
      })
      .join('\n');

    return {
      content: [
        {
          type: 'text',
          text: `**Journal Search** — "${args.query}" (${results.length} results)\n\n${formatted}`,
        },
      ],
    };
  });
}

type JournalPage = NonNullable<WorldJournal['pages']>[number];

/** Default and largest number of characters returned per call. */
const DEFAULT_MAX_CHARS = 20_000;
const MAX_MAX_CHARS = 100_000;
/** How far back from the cut point to look for whitespace to break on. */
const BREAK_WINDOW = 200;

function invalid(message: string): McpError {
  return new McpError(ErrorCode.InvalidParams, message);
}

function pageList(pages: JournalPage[]): string {
  return pages.map((p) => `- ${p.name} \`${p._id}\` (${p.type})`).join('\n');
}

/** Plain text of one page; non-text pages print their type, source and caption. */
function pageBody(page: JournalPage): string {
  if (page.type === 'text' || page.text) {
    const text = page.text as { content?: unknown; markdown?: unknown } | undefined;
    const body =
      htmlToText(text?.content) || (typeof text?.markdown === 'string' ? text.markdown.trim() : '');
    return body || '_(empty page)_';
  }
  const lines = [`_${page.type} page_${page.src ? ` — source: \`${page.src}\`` : ''}`];
  const caption = page.image?.caption;
  if (typeof caption === 'string' && caption.trim() !== '') {
    lines.push(`Caption: ${caption.trim()}`);
  }
  return lines.join('\n');
}

function selectPage(pages: JournalPage[], pageId?: string, pageName?: string): JournalPage {
  if (pageId !== undefined) {
    const page = pages.find((p) => p._id === pageId);
    if (!page) {
      throw invalid(`No page with id ${pageId} in this journal. Pages:\n${pageList(pages)}`);
    }
    return page;
  }
  const wanted = (pageName ?? '').trim().toLowerCase();
  const exact = pages.filter((p) => p.name.toLowerCase() === wanted);
  const matches =
    exact.length > 0 ? exact : pages.filter((p) => p.name.toLowerCase().includes(wanted));
  if (matches.length === 0) {
    throw invalid(`No page named "${pageName}" in this journal. Pages:\n${pageList(pages)}`);
  }
  if (matches.length > 1) {
    throw invalid(
      `"${pageName}" matches several pages; pass pageId instead:\n${pageList(matches)}`,
    );
  }
  return matches[0] as JournalPage;
}

/** End of the part starting at `offset`: at most `maxChars` on, broken at whitespace when possible. */
function partEnd(text: string, offset: number, maxChars: number): number {
  const limit = offset + maxChars;
  if (limit >= text.length) {
    return text.length;
  }
  const floor = Math.max(offset + 1, limit - BREAK_WINDOW);
  for (let i = limit; i > floor; i--) {
    if (/\s/.test(text[i - 1] ?? '')) {
      return i;
    }
  }
  return limit;
}

function optionalCount(name: string, value: unknown, min: number): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    throw invalid(`${name} must be a whole number of at least ${min}`);
  }
  return value;
}

function optionalString(name: string, value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalid(`${name} must be a non-empty string when given`);
  }
  return value;
}

/**
 * Handles get_journal: a journal's pages in full, or one page, read in parts
 * when long.
 */
export async function handleGetJournal(
  args: {
    journalId: string;
    pageId?: string;
    pageName?: string;
    offset?: number;
    maxChars?: number;
  },
  foundryClient: FoundryClient,
) {
  const pageId = optionalString('pageId', args.pageId);
  const pageName = optionalString('pageName', args.pageName);
  const offset = optionalCount('offset', args.offset, 0) ?? 0;
  const maxChars = Math.min(
    optionalCount('maxChars', args.maxChars, 1) ?? DEFAULT_MAX_CHARS,
    MAX_MAX_CHARS,
  );

  return withToolError('get journal', async () => {
    const journal = foundryClient.getJournal(args.journalId);

    if (!journal) {
      throw new McpError(ErrorCode.InvalidParams, `Journal not found: ${args.journalId}`);
    }

    const pages = [...(journal.pages ?? [])].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
    const header = [`**Journal: ${journal.name}**`, `ID: ${journal._id}`];

    if (pages.length === 0) {
      return { content: [{ type: 'text', text: `${header.join('\n')}\n\nNo pages.` }] };
    }

    const single = pageId !== undefined || pageName !== undefined;
    const shown = single ? [selectPage(pages, pageId, pageName)] : pages;
    if (!single && pages.length > 1) {
      header.push('', `**Pages (${pages.length}):**`, pageList(pages));
    }

    const body = shown.map((p) => `### ${p.name} \`${p._id}\`\n\n${pageBody(p)}`).join('\n\n');

    if (offset > 0 && offset >= body.length) {
      throw invalid(`offset ${offset} is past the end of the text (${body.length} characters).`);
    }
    const end = partEnd(body, offset, maxChars);
    const footer =
      end < body.length
        ? `_Showing characters ${offset}–${end} of ${body.length}. More follows: call get_journal again with offset: ${end}._`
        : `_End of text (characters ${offset}–${end} of ${body.length})._`;

    return {
      content: [
        {
          type: 'text',
          text: `${header.join('\n')}\n\n${body.slice(offset, end)}\n\n${footer}`,
        },
      ],
    };
  });
}
