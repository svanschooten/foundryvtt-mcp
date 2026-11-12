/**
 * @fileoverview Unit tests for journals handlers — search_journals and get_journal
 */

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it, vi } from 'vitest';
import type { FoundryClient } from '../../../foundry/client.js';
import { handleGetJournal, handleSearchJournals } from '../journals.js';

interface MockJournal {
  _id: string;
  name: string;
  pages?: Array<{
    _id: string;
    name: string;
    type: string;
    text?: { content: string; format: number; markdown?: string };
    src?: string;
    image?: Record<string, unknown>;
    sort?: number;
  }>;
}

function getText(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content[0]?.text ?? '';
}

function makeJournal(id: string, name: string, pageCount: number): MockJournal {
  return {
    _id: id,
    name,
    pages: Array.from({ length: pageCount }, (_, i) => ({
      _id: `${id}-page-${i}`,
      name: `Page ${i + 1}`,
      type: 'text',
      text: { content: `<p>Page ${i + 1} content for ${name}.</p>`, format: 1 },
    })),
  };
}

describe('handleSearchJournals', () => {
  describe('happy path', () => {
    it('formats matching journals with page count and ID', async () => {
      const journals: MockJournal[] = [
        makeJournal('jrnl-1', 'Adventure Log', 5),
        makeJournal('jrnl-2', 'Lore Compendium', 1),
        makeJournal('jrnl-3', 'Empty Journal', 0),
      ];
      const client = {
        searchJournals: vi.fn((_q: string) => journals),
      } as unknown as FoundryClient;

      const result = await handleSearchJournals({ query: 'adventure' }, client);
      const text = getText(result);

      expect(text).toContain('Journal Search');
      expect(text).toContain('"adventure"');
      expect(text).toContain('(3 results)');
      expect(text).toContain('**Adventure Log** (5 pages)');
      expect(text).toContain('**Lore Compendium** (1 page)');
      expect(text).toContain('**Empty Journal** (0 pages)');
      expect(text).toContain('ID: jrnl-1');
      expect(text).toContain('ID: jrnl-2');
      expect(client.searchJournals).toHaveBeenCalledWith('adventure');
    });

    it('honors a caller-supplied limit', async () => {
      const journals: MockJournal[] = Array.from({ length: 25 }, (_, i) =>
        makeJournal(`jrnl-${i}`, `Journal ${i}`, 1),
      );
      const client = {
        searchJournals: vi.fn(() => journals),
      } as unknown as FoundryClient;

      const result = await handleSearchJournals({ query: 'j', limit: 5 }, client);
      const text = getText(result);

      // Total count still reflects the full result set
      expect(text).toContain('(25 results)');
      // But only the first 5 entries are listed
      expect(text).toContain('**Journal 0**');
      expect(text).toContain('**Journal 4**');
      expect(text).not.toContain('**Journal 5**');
    });
  });

  describe('edge cases', () => {
    it('returns "No journals found" placeholder when search returns empty', async () => {
      const client = {
        searchJournals: vi.fn(() => []),
      } as unknown as FoundryClient;

      const result = await handleSearchJournals({ query: 'xyzzy' }, client);
      const text = getText(result);

      expect(text).toContain('No journals found matching "xyzzy".');
    });
  });
});

describe('handleGetJournal', () => {
  describe('happy path', () => {
    it('returns journal with HTML-stripped page content', async () => {
      const journal: MockJournal = {
        _id: 'jrnl-1',
        name: 'Test Journal',
        pages: [
          {
            _id: 'p-1',
            name: 'Introduction',
            type: 'text',
            text: { content: '<p>Hello <b>world</b>.</p>', format: 1 },
          },
        ],
      };
      const client = {
        getJournal: vi.fn((_id: string) => journal),
      } as unknown as FoundryClient;

      const result = await handleGetJournal({ journalId: 'jrnl-1' }, client);
      const text = getText(result);

      expect(text).toContain('**Journal: Test Journal**');
      expect(text).toContain('ID: jrnl-1');
      expect(text).toContain('### Introduction');
      expect(text).toContain('Hello **world**.');
      // HTML tags should have been stripped
      expect(text).not.toContain('<p>');
      expect(text).not.toContain('<b>');
      expect(client.getJournal).toHaveBeenCalledWith('jrnl-1');
    });

    it('falls back to "No pages." when journal has no pages', async () => {
      const journal: MockJournal = { _id: 'jrnl-2', name: 'Empty', pages: [] };
      const client = {
        getJournal: vi.fn(() => journal),
      } as unknown as FoundryClient;

      const result = await handleGetJournal({ journalId: 'jrnl-2' }, client);
      const text = getText(result);

      expect(text).toContain('**Journal: Empty**');
      expect(text).toContain('No pages.');
    });
  });

  describe('edge cases', () => {
    it('throws McpError when journal not found', async () => {
      const client = {
        getJournal: vi.fn(() => undefined),
      } as unknown as FoundryClient;

      await expect(handleGetJournal({ journalId: 'missing' }, client)).rejects.toThrow(
        /Journal not found: missing/,
      );
    });
  });
});

describe('handleGetJournal — full text and paging', () => {
  const LONG = `<h2>The Fall of Myth Drannor</h2>${Array.from(
    { length: 40 },
    (_, i) => `<p>Paragraph ${i + 1}: the elves &amp; their city fell to the Army of Darkness.</p>`,
  ).join('')}`;

  const LORE: MockJournal = {
    _id: 'jrnlLore00000001',
    name: 'Realm Lore',
    pages: [
      {
        _id: 'pageMap000000001',
        name: 'Map of the Dales',
        type: 'image',
        // Foundry v11 gives every page a text field, empty on image pages
        text: { content: '', format: 1 },
        src: 'worlds/divine-fools/maps/dales.webp',
        image: { caption: 'The Dalelands, 1492 DR' },
        sort: 300,
      },
      {
        _id: 'pageHistory00001',
        name: 'History',
        type: 'text',
        text: { content: LONG, format: 1 },
        sort: 100,
      },
      {
        _id: 'pageNotes0000001',
        name: 'GM Notes',
        type: 'text',
        text: { content: '<ul><li><p>Sergus owes the temple a favour.</p></li></ul>', format: 1 },
        sort: 200,
      },
      {
        _id: 'pageHandout00001',
        name: 'Handout',
        type: 'pdf',
        src: 'worlds/divine-fools/handouts/letter.pdf',
        sort: 400,
      },
    ],
  };

  function clientFor(journal: MockJournal | undefined = LORE) {
    return { getJournal: vi.fn(() => journal) } as unknown as FoundryClient;
  }

  async function read(args: Record<string, unknown>): Promise<string> {
    return getText(
      await handleGetJournal(
        { journalId: LORE._id, ...args } as { journalId: string },
        clientFor(),
      ),
    );
  }

  async function failure(args: Record<string, unknown>): Promise<McpError> {
    const error = await handleGetJournal(
      { journalId: LORE._id, ...args } as { journalId: string },
      clientFor(),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(McpError);
    return error as McpError;
  }

  it('returns a page longer than 500 characters whole', async () => {
    const text = await read({});
    expect(LONG.length).toBeGreaterThan(2000);
    expect(text).toContain('Paragraph 1: the elves & their city fell');
    expect(text).toContain('Paragraph 40: the elves & their city fell');
    expect(text).not.toContain('...');
  });

  it('keeps headings and list structure via the HTML-to-text helper', async () => {
    const text = await read({});
    expect(text).toContain('## The Fall of Myth Drannor');
    expect(text).toContain('- Sergus owes the temple a favour.');
  });

  it('orders pages by their sort value and prints page ids', async () => {
    const text = await read({});
    const order = ['### History', '### GM Notes', '### Map of the Dales', '### Handout'].map((h) =>
      text.indexOf(h),
    );
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).toContain('`pageHistory00001`');
  });

  it('lists the pages up front when the journal has several', async () => {
    const text = await read({});
    expect(text).toMatch(/\*\*Pages \(4\):\*\*/);
    expect(text).toMatch(/- History `pageHistory00001` \(text\)/);
    expect(text).toMatch(/- Map of the Dales `pageMap000000001` \(image\)/);
  });

  it('prints the type, source and caption of non-text pages', async () => {
    const text = await read({});
    expect(text).toContain('_image page_ — source: `worlds/divine-fools/maps/dales.webp`');
    expect(text).toContain('Caption: The Dalelands, 1492 DR');
    expect(text).toContain('_pdf page_ — source: `worlds/divine-fools/handouts/letter.pdf`');
  });

  it('falls back to stored markdown when a markdown page has no HTML', async () => {
    const journal: MockJournal = {
      _id: 'jrnlMarkdown0001',
      name: 'Markdown',
      pages: [
        {
          _id: 'pageMarkdown0001',
          name: 'Notes',
          type: 'text',
          text: { content: '', format: 2, markdown: '**Bold** plan' },
        },
      ],
    };
    const text = getText(await handleGetJournal({ journalId: journal._id }, clientFor(journal)));
    expect(text).toContain('**Bold** plan');
  });

  describe('single page', () => {
    it('returns one page by id', async () => {
      const text = await read({ pageId: 'pageNotes0000001' });
      expect(text).toContain('### GM Notes');
      expect(text).not.toContain('### History');
      expect(text).not.toContain('**Pages (');
    });

    it('returns one page by name, case-insensitively', async () => {
      const text = await read({ pageName: 'gm notes' });
      expect(text).toContain('### GM Notes');
      expect(text).not.toContain('### History');
    });

    it('matches a unique partial page name', async () => {
      const text = await read({ pageName: 'dales' });
      expect(text).toContain('### Map of the Dales');
    });

    it('rejects an unknown page and lists the pages there are', async () => {
      const error = await failure({ pageName: 'Bestiary' });
      expect(error.code).toBe(ErrorCode.InvalidParams);
      expect(error.message).toMatch(/Bestiary/);
      expect(error.message).toMatch(/History `pageHistory00001`/);
    });

    it('rejects an ambiguous partial page name', async () => {
      const error = await failure({ pageName: 'a' });
      expect(error.code).toBe(ErrorCode.InvalidParams);
      expect(error.message).toMatch(/matches several pages/);
    });
  });

  describe('paging', () => {
    it('cuts at maxChars and says where the next part starts', async () => {
      const text = await read({ pageId: 'pageHistory00001', maxChars: 1000 });
      const next = text.match(/offset: (\d+)/);
      expect(next).not.toBeNull();
      expect(text).toMatch(/Showing characters 0–\d+ of \d+/);
      expect(text).not.toContain('Paragraph 40');
    });

    it('returns consecutive parts that join back into the whole page', async () => {
      const whole = await read({ pageId: 'pageHistory00001' });
      const body = (t: string) => t.slice(t.indexOf('### History'), t.search(/\n\n_(Showing|End)/));
      const parts: string[] = [];
      let offset = 0;
      for (let guard = 0; guard < 20; guard++) {
        const text = await read({ pageId: 'pageHistory00001', maxChars: 700, offset });
        parts.push(
          text.slice(
            text.indexOf('\n\n', text.indexOf('ID:')) + 2,
            text.search(/\n\n_(Showing|End)/),
          ),
        );
        const next = text.match(/offset: (\d+)/);
        if (!next) {
          break;
        }
        offset = Number(next[1]);
      }
      expect(parts.length).toBeGreaterThan(2);
      expect(parts.join('')).toBe(body(whole));
    });

    it('lists the pages only on the first part', async () => {
      const first = await read({ maxChars: 500 });
      const next = Number(first.match(/offset: (\d+)/)?.[1]);
      const second = await read({ maxChars: 500, offset: next });
      expect(first).toContain('**Pages (4):**');
      expect(second).not.toContain('**Pages (');
    });

    it('names every argument the continuation call needs, page selection included', async () => {
      const text = await read({ pageId: 'pageHistory00001', maxChars: 1000 });
      const footer = text.slice(text.search(/\n\n_Showing/));
      expect(footer).toContain(`journalId: "${LORE._id}"`);
      expect(footer).toContain('pageId: "pageHistory00001"');
      expect(footer).toContain('maxChars: 1000');
      expect(footer).toMatch(/offset: \d+/);
    });

    it('repeats a pageName selection in the continuation call', async () => {
      const text = await read({ pageName: 'history', maxChars: 1000 });
      expect(text).toContain('pageName: "history"');
      expect(text).not.toContain('pageId:');
    });

    it('leaves out page and size arguments that were not given', async () => {
      const text = await read({ maxChars: 500 });
      const footer = text.slice(text.search(/\n\n_Showing/));
      expect(footer).not.toContain('pageId');
      expect(footer).not.toContain('pageName');
      expect(footer).toContain('maxChars: 500');
    });

    it('never cuts an emoji in half when it has to cut without whitespace', async () => {
      const journal: MockJournal = {
        _id: 'jrnlEmoji0000001',
        name: 'Emoji',
        pages: [
          {
            _id: 'pageEmoji0000001',
            name: 'E',
            type: 'text',
            text: { content: `<p>${'🐉'.repeat(400)}</p>`, format: 1 },
          },
        ],
      };
      const client = clientFor(journal);
      let offset = 0;
      const parts: string[] = [];
      for (let guard = 0; guard < 10; guard++) {
        const text = getText(
          await handleGetJournal({ journalId: journal._id, maxChars: 301, offset }, client),
        );
        const body = text.slice(
          text.indexOf('\n\n', text.indexOf('ID:')) + 2,
          text.search(/\n\n_/),
        );
        parts.push(body);
        expect(body).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
        const next = text.match(/offset: (\d+)/);
        if (!next) {
          break;
        }
        offset = Number(next[1]);
      }
      expect(parts.join('')).toContain('🐉'.repeat(400));
    });

    it('caps maxChars at 50000 characters per call', async () => {
      const journal: MockJournal = {
        _id: 'jrnlHuge00000001',
        name: 'Huge',
        pages: [
          {
            _id: 'pageHuge00000001',
            name: 'Huge',
            type: 'text',
            text: { content: `<p>${'word '.repeat(20_000)}</p>`, format: 1 },
          },
        ],
      };
      const text = getText(
        await handleGetJournal({ journalId: journal._id, maxChars: 1_000_000 }, clientFor(journal)),
      );
      const end = Number(text.match(/Showing characters 0–(\d+)/)?.[1]);
      expect(end).toBeGreaterThan(0);
      expect(end).toBeLessThanOrEqual(50_000);
      expect(text).toContain('maxChars: 50000');
    });

    it('says when the whole text fits', async () => {
      const text = await read({ pageId: 'pageNotes0000001' });
      expect(text).not.toMatch(/offset: \d+/);
    });

    it('rejects an offset past the end', async () => {
      const error = await failure({ pageId: 'pageNotes0000001', offset: 99999 });
      expect(error.code).toBe(ErrorCode.InvalidParams);
      expect(error.message).toMatch(/past the end/);
    });

    it.each([
      ['offset', -1],
      ['offset', 1.5],
      ['maxChars', 0],
      ['maxChars', 'lots'],
    ])('rejects %s = %s', async (key, value) => {
      const error = await failure({ [key]: value });
      expect(error.code).toBe(ErrorCode.InvalidParams);
    });
  });
});
