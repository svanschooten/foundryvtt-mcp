/**
 * @fileoverview Reads an actor's level, class breakdown and challenge rating
 * from stored data.
 *
 * dnd5e-specific, and kept in this one file so it is easy to replace after a
 * system upgrade. In dnd5e 3.x a character's level is not stored on the actor:
 * it is the sum of `system.levels` on the actor's `class` items, and each
 * `subclass` item names its class through `system.classIdentifier`. NPCs store
 * a challenge rating in `system.details.cr` instead.
 *
 * This only adds up and links stored values — no game rules are applied.
 * Other game systems fall back to a stored `system.details.level`.
 */

import type { WorldActor, WorldItem } from './types.js';

export interface ActorClass {
  name: string;
  /** Stored `system.levels`; absent when the class item stores no number. */
  levels?: number;
  /** Name of the subclass item linked to this class, when there is one. */
  subclass?: string;
}

export interface ActorProgression {
  level?: number;
  classes?: ActorClass[];
  cr?: number;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Approximates Foundry's `String#slugify`, which dnd5e uses as a class's
 * identifier when `system.identifier` is blank.
 */
function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ'"]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

function identifierOf(item: WorldItem): string {
  const stored = record(item.system).identifier;
  return typeof stored === 'string' && stored !== '' ? stored : slugify(item.name);
}

/**
 * Returns the stored level (summed over class items, else `details.level`),
 * the per-class breakdown with linked subclasses, and a stored CR. Fields are
 * left out when nothing is stored for them.
 */
export function actorProgression(actor: WorldActor): ActorProgression {
  const details = record(record(actor.system).details);
  const items = Array.isArray(actor.items) ? actor.items : [];
  const result: ActorProgression = {};

  const classItems = items.filter((i) => i.type === 'class');
  if (classItems.length > 0) {
    const subclasses = items.filter((i) => i.type === 'subclass');
    const classes = classItems.map((item): ActorClass => {
      const entry: ActorClass = { name: item.name };
      const levels = finite(record(item.system).levels);
      if (levels !== undefined) {
        entry.levels = levels;
      }
      const id = identifierOf(item);
      const subclass = subclasses.find((s) => record(s.system).classIdentifier === id);
      if (subclass) {
        entry.subclass = subclass.name;
      }
      return entry;
    });
    classes.sort((a, b) => (b.levels ?? 0) - (a.levels ?? 0));
    result.classes = classes;

    const stored = classes.filter((c) => c.levels !== undefined);
    if (stored.length > 0) {
      result.level = stored.reduce((sum, c) => sum + (c.levels ?? 0), 0);
    }
  }

  if (result.level === undefined) {
    const level = finite(details.level);
    if (level !== undefined) {
      result.level = level;
    }
  }

  const cr = finite(details.cr);
  if (cr !== undefined) {
    result.cr = cr;
  }

  return result;
}

const CR_FRACTIONS: ReadonlyMap<number, string> = new Map([
  [0.125, '1/8'],
  [0.25, '1/4'],
  [0.5, '1/2'],
]);

/** Prints a stored CR the way it is written at the table (0.25 → "1/4"). */
export function formatChallengeRating(cr: number): string {
  return CR_FRACTIONS.get(cr) ?? String(cr);
}
