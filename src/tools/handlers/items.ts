/**
 * @fileoverview World item tool handlers: search_items and get_item.
 *
 * Read-only. Both read the world's Items sidebar from the cached world data;
 * items an actor owns are read with get_actor_items instead. Only stored
 * values are printed — no default rarity or price is made up.
 */

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { FoundryClient } from '../../foundry/client.js';
import type { FoundryItem } from '../../foundry/types.js';
import { htmlToText } from '../../utils/html-to-text.js';
import { formatItemDetails } from './item-format.js';
import { withToolError } from './utils.js';

/** Characters of description shown on each side of a text match. */
const SNIPPET_CONTEXT = 80;

/**
 * The part of an item's description around the first match of `query`, for
 * results that matched on description text rather than name.
 */
function descriptionSnippet(item: FoundryItem, query: string): string | undefined {
  const text = htmlToText(item.description).replace(/\s+/g, ' ');
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at === -1) {
    return undefined;
  }
  const start = Math.max(0, at - SNIPPET_CONTEXT);
  const end = Math.min(text.length, at + query.length + SNIPPET_CONTEXT);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

function formatSearchLine(item: FoundryItem, query: string, searchText: boolean): string {
  const parts = [
    item.rarity,
    item.price && `${item.price.value} ${item.price.denomination}`.trim(),
    item.folderName && `in ${item.folderName}`,
  ].filter((p): p is string => typeof p === 'string' && p !== '');
  const line = `- **${item.name}** \`${item._id}\` (${item.type})${parts.length > 0 ? ` — ${parts.join(', ')}` : ''}`;

  if (!searchText || !query || item.name.toLowerCase().includes(query.toLowerCase())) {
    return line;
  }
  const snippet = descriptionSnippet(item, query);
  return snippet ? `${line}\n  _description:_ ${snippet}` : line;
}

/**
 * Handles search_items: find world items by name (and optionally description).
 */
export async function handleSearchItems(
  args: {
    query?: string;
    type?: string;
    rarity?: string;
    limit?: number;
    searchText?: boolean;
  },
  foundryClient: FoundryClient,
) {
  const { query, type, rarity, limit = 10 } = args;
  const searchText = args.searchText === true;

  return withToolError('search items', async () => {
    const searchParams: {
      query: string;
      type?: string;
      rarity?: string;
      limit: number;
      searchText?: boolean;
    } = {
      query: query || '',
      limit,
    };
    if (type) {
      searchParams.type = type;
    }
    if (rarity) {
      searchParams.rarity = rarity;
    }
    if (searchText) {
      searchParams.searchText = true;
    }
    const result = await foundryClient.searchItems(searchParams);

    const itemList = result.items
      .map((item) => formatSearchLine(item, query ?? '', searchText))
      .join('\n');

    const hidden = result.total - result.items.length;
    const moreNote =
      hidden > 0
        ? `\n\n_${hidden} more match — narrow the query or raise the limit to see them._`
        : '';

    return {
      content: [
        {
          type: 'text',
          text: `⚔️ **Item Search Results**
**Query:** ${query || 'All items'}${searchText ? ' (names and descriptions)' : ''}
**Type Filter:** ${type || 'All types'}
**Rarity Filter:** ${rarity || 'All rarities'}
**Results:** ${result.items.length}/${result.total} total

${itemList || 'No items found matching the criteria.'}${moreNote}

**Page:** ${result.page} | **Limit:** ${result.limit}`,
        },
      ],
    };
  });
}

/**
 * Handles get_item: one world item in full, as stored.
 */
export async function handleGetItem(args: { itemId: string }, foundryClient: FoundryClient) {
  const { itemId } = args;

  if (!itemId || typeof itemId !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, 'itemId is required and must be a string');
  }

  return withToolError('get item', async () => {
    const found = foundryClient.getWorldItem(itemId);
    if (!found) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `No world item with id ${itemId}. Find world item ids with search_items; items an actor owns are read with get_actor_items.`,
      );
    }
    const options = found.folderName ? { folderName: found.folderName } : {};
    return {
      content: [
        {
          type: 'text',
          text: `📦 **World item**\n\n${formatItemDetails(found.item, new Map(), options)}`,
        },
      ],
    };
  });
}
