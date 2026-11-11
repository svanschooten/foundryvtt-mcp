/**
 * @fileoverview Unit tests for items handlers — search_items and get_item
 */

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it, vi } from 'vitest';
import type { FoundryClient } from '../../../foundry/client.js';
import type { WorldItem } from '../../../foundry/types.js';
import { handleGetItem, handleSearchItems } from '../items.js';

interface MockItem {
  _id: string;
  name: string;
  type: string;
  rarity?: string;
  price?: { value: number; denomination: string };
  folderName?: string;
  description?: string;
}

interface MockSearchParams {
  query: string;
  type?: string;
  rarity?: string;
  limit: number;
  searchText?: boolean;
}

function mockFoundryClient(result: {
  items: MockItem[];
  total: number;
  page: number;
  limit: number;
}): { client: FoundryClient; calls: { params: MockSearchParams[] } } {
  const calls = { params: [] as MockSearchParams[] };
  const client = {
    searchItems: vi.fn(async (params: MockSearchParams) => {
      calls.params.push(params);
      return result;
    }),
  } as unknown as FoundryClient;
  return { client, calls };
}

function getText(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content[0]?.text ?? '';
}

describe('handleSearchItems', () => {
  describe('happy path', () => {
    it('prints each item with its id, type, stored rarity and price', async () => {
      const { client, calls } = mockFoundryClient({
        items: [
          {
            _id: 'itemLongsword001',
            name: 'Longsword',
            type: 'weapon',
            rarity: 'common',
            price: { value: 15, denomination: 'gp' },
          },
          {
            _id: 'itemPotion000001',
            name: 'Potion of Healing',
            type: 'consumable',
            rarity: 'common',
            price: { value: 50, denomination: 'gp' },
          },
        ],
        total: 2,
        page: 1,
        limit: 10,
      });

      const text = getText(
        await handleSearchItems({ query: 'sword', type: 'weapon', rarity: 'common' }, client),
      );

      expect(text).toContain('Item Search Results');
      expect(text).toContain('**Query:** sword');
      expect(text).toContain('**Type Filter:** weapon');
      expect(text).toContain('**Rarity Filter:** common');
      expect(text).toContain('**Results:** 2/2 total');
      expect(text).toContain('- **Longsword** `itemLongsword001` (weapon) — common, 15 gp');
      expect(text).toContain(
        '- **Potion of Healing** `itemPotion000001` (consumable) — common, 50 gp',
      );
      expect(text).toContain('**Page:** 1 | **Limit:** 10');

      expect(calls.params).toHaveLength(1);
      expect(calls.params[0]).toMatchObject({
        query: 'sword',
        type: 'weapon',
        rarity: 'common',
        limit: 10,
      });
    });

    it('defaults query/type/rarity labels when none supplied and uses default limit 10', async () => {
      const { client, calls } = mockFoundryClient({ items: [], total: 0, page: 1, limit: 10 });

      const text = getText(await handleSearchItems({}, client));

      expect(text).toContain('**Query:** All items');
      expect(text).toContain('**Type Filter:** All types');
      expect(text).toContain('**Rarity Filter:** All rarities');
      expect(calls.params[0]).toEqual({ query: '', limit: 10 });
    });

    it('prints the folder an item is filed in', async () => {
      const { client } = mockFoundryClient({
        items: [
          {
            _id: 'itemAuraSelune01',
            name: 'Aura of Selune',
            type: 'feat',
            folderName: 'Homebrew / Features',
          },
        ],
        total: 1,
        page: 1,
        limit: 10,
      });

      const text = getText(await handleSearchItems({ query: 'aura' }, client));

      expect(text).toContain(
        '- **Aura of Selune** `itemAuraSelune01` (feat) — in Homebrew / Features',
      );
    });

    it('tells duplicate names apart by id', async () => {
      const { client } = mockFoundryClient({
        items: [
          { _id: 'itemArcVigor0001', name: 'Arcane Vigor', type: 'feat' },
          { _id: 'itemArcVigor0002', name: 'Arcane Vigor', type: 'feat' },
        ],
        total: 2,
        page: 1,
        limit: 10,
      });

      const text = getText(await handleSearchItems({ query: 'arcane vigor' }, client));

      expect(text).toContain('`itemArcVigor0001`');
      expect(text).toContain('`itemArcVigor0002`');
    });

    it('says how many more match when the limit cuts the list short', async () => {
      const { client } = mockFoundryClient({
        items: [{ _id: 'itemSpell0000001', name: 'Bless', type: 'spell' }],
        total: 4,
        page: 1,
        limit: 1,
      });

      const text = getText(await handleSearchItems({ limit: 1 }, client));

      expect(text).toContain('3 more match');
    });
  });

  describe('searchText', () => {
    it('forwards the flag to the client', async () => {
      const { client, calls } = mockFoundryClient({ items: [], total: 0, page: 1, limit: 10 });

      await handleSearchItems({ query: 'moonlight', searchText: true }, client);

      expect(calls.params[0]).toMatchObject({ query: 'moonlight', searchText: true });
    });

    it('shows where the query matched in the description', async () => {
      const { client } = mockFoundryClient({
        items: [
          {
            _id: 'itemAuraSelune01',
            name: 'Aura of Selune',
            type: 'feat',
            description:
              '<p>As a bonus action you shed <strong>moonlight</strong> in a 10-foot radius.</p>',
          },
        ],
        total: 1,
        page: 1,
        limit: 10,
      });

      const text = getText(
        await handleSearchItems({ query: 'moonlight', searchText: true }, client),
      );

      expect(text).toMatch(/Aura of Selune.*\n\s+.*shed \*\*moonlight\*\* in a 10-foot radius/);
    });

    it('does not print a description match when the name matches', async () => {
      const { client } = mockFoundryClient({
        items: [
          {
            _id: 'itemMoonbeam0001',
            name: 'Moonbeam',
            type: 'spell',
            description: '<p>A silvery beam of pale light.</p>',
          },
        ],
        total: 1,
        page: 1,
        limit: 10,
      });

      const text = getText(await handleSearchItems({ query: 'moon', searchText: true }, client));

      expect(text).not.toContain('silvery beam');
    });
  });

  describe('edge cases', () => {
    it('renders "No items found" placeholder for empty result set', async () => {
      const { client } = mockFoundryClient({ items: [], total: 0, page: 1, limit: 10 });

      const text = getText(await handleSearchItems({ query: 'xyzzy' }, client));

      expect(text).toContain('No items found matching the criteria.');
    });

    it('prints no rarity or price when none is stored', async () => {
      const { client } = mockFoundryClient({
        items: [{ _id: 'itemMystery00001', name: 'Mystery Box', type: 'loot' }],
        total: 1,
        page: 1,
        limit: 10,
      });

      const text = getText(await handleSearchItems({ query: 'box' }, client));

      expect(text).toMatch(/^- \*\*Mystery Box\*\* `itemMystery00001` \(loot\)$/m);
      expect(text).not.toContain('Common');
      expect(text).not.toContain('Unknown price');
    });
  });
});

describe('handleGetItem', () => {
  const AURA: WorldItem = {
    _id: 'itemAuraSelune01',
    name: 'Aura of Selune',
    type: 'feat',
    folder: 'folderHomebrew01',
    system: {
      description: { value: '<p>You shed &amp;Reference[bright]{bright} moonlight.</p>' },
      type: { value: 'class', subtype: '' },
      requirements: 'Cleric 3',
      activation: { type: 'bonus', cost: 1, condition: '' },
      uses: { value: 1, max: '2', per: 'lr', recovery: '' },
    },
  };

  function clientWith(item: WorldItem | undefined, folderName?: string) {
    const getWorldItem = vi.fn(() => (item ? { item, folderName } : undefined));
    return { client: { getWorldItem } as unknown as FoundryClient, getWorldItem };
  }

  it('returns the full stored item with its folder', async () => {
    const { client, getWorldItem } = clientWith(AURA, 'Homebrew / Features');

    const text = getText(await handleGetItem({ itemId: AURA._id }, client));

    expect(getWorldItem).toHaveBeenCalledWith(AURA._id);
    expect(text).toContain('### Aura of Selune');
    expect(text).toContain('**Item ID:** `itemAuraSelune01`');
    expect(text).toContain('**Folder:** Homebrew / Features');
    expect(text).toContain('**Requirements:** Cleric 3');
    expect(text).toContain('**Uses:** 1/2 per lr');
    expect(text).toContain('**Activation:** 1 bonus');
    expect(text).toContain('You shed bright moonlight.');
  });

  it('leaves the folder out when the item is not in one', async () => {
    const { client } = clientWith({ ...AURA, folder: null });

    const text = getText(await handleGetItem({ itemId: AURA._id }, client));

    expect(text).not.toContain('Folder');
  });

  it('rejects an unknown item id with a pointer to search_items', async () => {
    const { client } = clientWith(undefined);

    const error = await handleGetItem({ itemId: 'itemMissing00001' }, client).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(McpError);
    expect((error as McpError).code).toBe(ErrorCode.InvalidParams);
    expect((error as McpError).message).toMatch(/itemMissing00001.*search_items/);
  });

  it('rejects a missing itemId', async () => {
    const { client, getWorldItem } = clientWith(AURA);

    await expect(
      handleGetItem({ itemId: '' } as { itemId: string }, client),
    ).rejects.toBeInstanceOf(McpError);
    expect(getWorldItem).not.toHaveBeenCalled();
  });
});
