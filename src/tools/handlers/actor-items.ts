/**
 * @fileoverview get_actor_items — read the items an actor owns.
 *
 * Read-only. Lists an actor's features, spells, inventory and classes from the
 * cached world data, grouped by type (spells by level), or returns one owned
 * item in full when `itemId` is given. Item ids printed here are the ones
 * update_actor_item / delete_actor_item need.
 */

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { FoundryClient } from '../../foundry/client.js';
import type { WorldItem } from '../../foundry/types.js';
import { formatItemDetails, formatItemSummary, spellLevel } from './item-format.js';
import { withToolError } from './utils.js';

/** Display order and headings for known dnd5e item types; others follow alphabetically. */
const TYPE_HEADINGS: ReadonlyArray<readonly [string, string]> = [
  ['class', 'Classes'],
  ['subclass', 'Subclasses'],
  ['background', 'Background'],
  ['race', 'Race / species'],
  ['feat', 'Features'],
  ['spell', 'Spells'],
  ['weapon', 'Weapons'],
  ['equipment', 'Equipment'],
  ['consumable', 'Consumables'],
  ['tool', 'Tools'],
  ['container', 'Containers'],
  ['backpack', 'Containers'],
  ['loot', 'Loot'],
];

const TYPE_RANK = new Map(TYPE_HEADINGS.map(([type], index) => [type, index]));
const HEADING = new Map(TYPE_HEADINGS);

function byName(a: WorldItem, b: WorldItem): number {
  return a.name.localeCompare(b.name);
}

function compareTypes(a: string, b: string): number {
  const ra = TYPE_RANK.get(a) ?? Number.POSITIVE_INFINITY;
  const rb = TYPE_RANK.get(b) ?? Number.POSITIVE_INFINITY;
  return ra !== rb ? ra - rb : a.localeCompare(b);
}

function spellSections(spells: WorldItem[], names: ReadonlyMap<string, string>): string[] {
  const byLevel = new Map<number | undefined, WorldItem[]>();
  for (const spell of spells) {
    const level = spellLevel(spell);
    const group = byLevel.get(level) ?? [];
    group.push(spell);
    byLevel.set(level, group);
  }
  const levels = [...byLevel.keys()].sort(
    (a, b) => (a ?? Number.POSITIVE_INFINITY) - (b ?? Number.POSITIVE_INFINITY),
  );
  return levels.map((level) => {
    const heading =
      level === undefined ? 'Level not stored' : level === 0 ? 'Cantrips' : `Level ${level}`;
    const lines = (byLevel.get(level) ?? []).sort(byName).map((s) => formatItemSummary(s, names));
    return `### ${heading}\n${lines.join('\n')}`;
  });
}

function formatGrouped(items: WorldItem[], names: ReadonlyMap<string, string>): string {
  const groups = new Map<string, WorldItem[]>();
  for (const item of items) {
    // container/backpack share a heading, so share a group too
    const key = item.type === 'backpack' ? 'container' : item.type;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return [...groups.keys()]
    .sort(compareTypes)
    .map((type) => {
      const group = groups.get(type) ?? [];
      const heading = `## ${HEADING.get(type) ?? type} (${group.length})`;
      const body =
        type === 'spell'
          ? spellSections(group, names).join('\n\n')
          : group
              .sort(byName)
              .map((item) => formatItemSummary(item, names))
              .join('\n');
      return `${heading}\n${body}`;
    })
    .join('\n\n');
}

/**
 * Handles get_actor_items: list an actor's owned items, or read one in full.
 */
export async function handleGetActorItems(
  args: {
    actorId: string;
    type?: string;
    query?: string;
    itemId?: string;
  },
  foundryClient: FoundryClient,
) {
  const { actorId, type, query, itemId } = args;

  if (!actorId || typeof actorId !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, 'actorId is required and must be a string');
  }

  return withToolError('get actor items', async () => {
    const { actor, items } = foundryClient.getActorItems(actorId);
    const names = new Map(items.map((i) => [i._id, i.name]));
    const header = `🎒 **Owned items: ${actor.name}** (${actor.type}, \`${actor._id}\`)`;

    if (itemId) {
      const item = items.find((i) => i._id === itemId);
      if (!item) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Actor ${actor.name} (${actor._id}) does not own an item with id ${itemId}. Call get_actor_items without itemId to list the owned item ids.`,
        );
      }
      return {
        content: [{ type: 'text', text: `${header}\n\n${formatItemDetails(item, names)}` }],
      };
    }

    if (items.length === 0) {
      return {
        content: [{ type: 'text', text: `${header}\n\n${actor.name} owns no items.` }],
      };
    }

    const types = type
      ? type
          .split(',')
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean)
      : [];
    const q = query?.trim().toLowerCase();
    const matches = items.filter(
      (i) =>
        (types.length === 0 || types.includes(i.type.toLowerCase())) &&
        (!q || i.name.toLowerCase().includes(q)),
    );

    const filters = [type && `type: ${type}`, q && `name contains "${query?.trim()}"`].filter(
      Boolean,
    );
    const summary = [
      header,
      `**Showing:** ${matches.length} of ${items.length} items${filters.length > 0 ? ` (${filters.join(', ')})` : ''}`,
    ].join('\n');

    if (matches.length === 0) {
      const owned = [...new Set(items.map((i) => i.type))].sort(compareTypes).join(', ');
      return {
        content: [
          {
            type: 'text',
            text: `${summary}\n\nNo items match these filters. Types owned: ${owned}.`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: `${summary}\n\n${formatGrouped(matches, names)}\n\n_Values are shown as stored; values the game system calculates (modifiers, attack bonus, save DC) are not included. Pass itemId to read one item in full (description, activation, range, damage)._`,
        },
      ],
    };
  });
}
