/**
 * @fileoverview Actor management tool handlers
 *
 * Handles searching for actors and retrieving detailed actor information.
 */

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { formatChallengeRating } from '../../foundry/actor-progression.js';
import type { FoundryClient } from '../../foundry/client.js';
import type { FoundryActor } from '../../foundry/types.js';
import { htmlToText } from '../../utils/html-to-text.js';
import { withToolError } from './utils.js';

/** "Fighter 5 (Battle Master) / Rogue 2"; subclasses only when asked for. */
function formatClasses(actor: FoundryActor, withSubclass: boolean): string | undefined {
  if (!actor.classes || actor.classes.length === 0) {
    return undefined;
  }
  return actor.classes
    .map((c) => {
      const levels = c.levels !== undefined ? ` ${c.levels}` : '';
      const subclass = withSubclass && c.subclass ? ` (${c.subclass})` : '';
      return `${c.name}${levels}${subclass}`;
    })
    .join(' / ');
}

/**
 * NPCs with a stored CR show it instead of a level (their level is not a thing
 * in dnd5e); everyone else shows the stored level, with the class breakdown.
 */
function showsChallengeRating(actor: FoundryActor): actor is FoundryActor & { cr: number } {
  return actor.type === 'npc' && actor.cr !== undefined;
}

function levelSummary(actor: FoundryActor): string {
  if (showsChallengeRating(actor)) {
    return `CR ${formatChallengeRating(actor.cr)}`;
  }
  if (actor.level === undefined) {
    return 'Level not stored';
  }
  const classes = formatClasses(actor, false);
  return `Level ${actor.level}${classes ? ` (${classes})` : ''}`;
}

/**
 * "20", or "8 (-1)" when a modifier is stored. dnd5e does not store the
 * modifier (it is calculated in the browser), so it is never worked out here.
 */
function formatAbility(ability: { value?: number; mod?: number }): string {
  if (ability.value === undefined) {
    return 'not stored';
  }
  if (ability.mod === undefined) {
    return String(ability.value);
  }
  return `${ability.value} (${ability.mod >= 0 ? '+' : ''}${ability.mod})`;
}

const CHARACTERISTIC_LABELS = [
  ['appearance', 'Appearance'],
  ['trait', 'Personality traits'],
  ['ideal', 'Ideals'],
  ['bond', 'Bonds'],
  ['flaw', 'Flaws'],
] as const;

/**
 * Stored biography as text, the public biography when it says something
 * else, and any stored characteristics (appearance, traits, ideals, …).
 */
function formatBiography(actor: FoundryActor): string {
  const biography = htmlToText(actor.biography);
  const publicBiography = htmlToText(actor.publicBiography);
  const sections = [biography ? `**Biography:**\n${biography}` : '**Biography:** not stored'];
  if (publicBiography && publicBiography !== biography) {
    sections.push(`**Public biography:**\n${publicBiography}`);
  }
  // One-line values stack under each other; a multi-line value gets its own block.
  let run: string[] = [];
  for (const [key, label] of CHARACTERISTIC_LABELS) {
    const value = actor.characteristics?.[key];
    if (!value) {
      continue;
    }
    if (value.includes('\n')) {
      if (run.length > 0) {
        sections.push(run.join('\n'));
        run = [];
      }
      sections.push(`**${label}:**\n${value}`);
    } else {
      run.push(`**${label}:** ${value}`);
    }
  }
  if (run.length > 0) {
    sections.push(run.join('\n'));
  }
  return sections.join('\n\n');
}

/**
 * Handles actor search requests
 */
export async function handleSearchActors(
  args: {
    query?: string;
    type?: string;
    limit?: number;
  },
  foundryClient: FoundryClient,
) {
  const { query, type, limit = 10 } = args;

  return withToolError('search actors', async () => {
    const searchParams: { query: string; type?: string; limit: number } = {
      query: query || '',
      limit,
    };
    if (type) {
      searchParams.type = type;
    }
    const result = await foundryClient.searchActors(searchParams);

    const actorList = result.actors
      .map(
        (actor) =>
          `- **${actor.name}** \`${actor._id}\` (${actor.type}) - ${levelSummary(actor)} - HP: ${actor.hp?.value || 'Unknown'}/${actor.hp?.max || 'Unknown'}`,
      )
      .join('\n');

    const hidden = result.total - result.actors.length;
    const moreNote =
      hidden > 0
        ? `\n\n_${hidden} more match — narrow the query or raise the limit to see them._`
        : '';

    return {
      content: [
        {
          type: 'text',
          text: `🎭 **Actor Search Results**
**Query:** ${query || 'All actors'}
**Type Filter:** ${type || 'All types'}
**Results:** ${result.actors.length}/${result.total} total

${actorList || 'No actors found matching the criteria.'}${moreNote}

**Page:** ${result.page} | **Limit:** ${result.limit}`,
        },
      ],
    };
  });
}

/**
 * Handles detailed actor information requests
 */
export async function handleGetActorDetails(
  args: {
    actorId: string;
  },
  foundryClient: FoundryClient,
) {
  const { actorId } = args;

  if (!actorId || typeof actorId !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, 'Actor ID is required and must be a string');
  }

  return withToolError('get actor details', async () => {
    const actor = await foundryClient.getActor(actorId);

    const abilities = actor.abilities
      ? Object.entries(actor.abilities)
          .map(([key, ability]) => `**${key.toUpperCase()}:** ${formatAbility(ability)}`)
          .join('\n')
      : 'No ability scores available';

    const classes = formatClasses(actor, true);
    const progression = showsChallengeRating(actor)
      ? `**Challenge Rating:** ${formatChallengeRating(actor.cr)}`
      : `**Level:** ${actor.level ?? 'not stored'}${classes ? `\n**Classes:** ${classes}` : ''}`;

    return {
      content: [
        {
          type: 'text',
          text: `🎭 **Actor Details: ${actor.name}**
**Type:** ${actor.type}
${progression}
**Hit Points:** ${actor.hp?.value || 'Unknown'}/${actor.hp?.max || 'Unknown'}
**Armor Class:** ${actor.ac?.value || 'Unknown'}

**Ability Scores:**
${abilities}

${formatBiography(actor)}`,
        },
      ],
    };
  });
}
