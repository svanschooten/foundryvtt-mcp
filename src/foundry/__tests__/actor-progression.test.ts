/**
 * @fileoverview Unit tests for reading level, classes and CR from stored actor data
 */

import { describe, expect, it } from 'vitest';
import { actorProgression, formatChallengeRating } from '../actor-progression.js';
import type { WorldActor, WorldItem } from '../types.js';

function actor(type: string, system: Record<string, unknown>, items: WorldItem[] = []): WorldActor {
  return { _id: 'actorAAAAAAAAAAA', name: 'Test', type, system, items };
}

function cls(name: string, levels: unknown, identifier = ''): WorldItem {
  return {
    _id: `class${name}`.padEnd(16, '0').slice(0, 16),
    name,
    type: 'class',
    system: { identifier, levels },
  };
}

function sub(name: string, classIdentifier: string): WorldItem {
  return {
    _id: `sub${name}`.padEnd(16, '0').slice(0, 16),
    name,
    type: 'subclass',
    system: { identifier: name.toLowerCase(), classIdentifier },
  };
}

/** Fighter 5 (Battle Master) / Rogue 2 (Thief); the rogue's identifier is unset. */
const MULTICLASS = actor('character', { details: {} }, [
  cls('Fighter', 5, 'fighter'),
  sub('Battle Master', 'fighter'),
  cls('Rogue', 2),
  sub('Thief', 'rogue'),
  { _id: 'weaponSword00001', name: 'Longsword', type: 'weapon', system: { quantity: 1 } },
]);

describe('actorProgression', () => {
  it('sums stored class levels for a dnd5e character', () => {
    expect(actorProgression(MULTICLASS).level).toBe(7);
  });

  it('returns the class breakdown, highest level first, with linked subclasses', () => {
    expect(actorProgression(MULTICLASS).classes).toEqual([
      { name: 'Fighter', levels: 5, subclass: 'Battle Master' },
      { name: 'Rogue', levels: 2, subclass: 'Thief' },
    ]);
  });

  it('links a subclass by the slugified class name when the identifier is unset', () => {
    const a = actor('character', {}, [
      cls('Blood Hunter', 3),
      sub('Order of the Lycan', 'blood-hunter'),
    ]);
    expect(actorProgression(a).classes).toEqual([
      { name: 'Blood Hunter', levels: 3, subclass: 'Order of the Lycan' },
    ]);
  });

  it('strips accents and quotes when slugifying a class name', () => {
    const a = actor('character', {}, [cls("Séance Pugilist's", 1), sub('Way', 'seance-pugilists')]);
    expect(actorProgression(a).classes?.[0]?.subclass).toBe('Way');
  });

  it('leaves subclass out when none is linked', () => {
    const a = actor('character', {}, [cls('Wizard', 1, 'wizard')]);
    expect(actorProgression(a).classes).toEqual([{ name: 'Wizard', levels: 1 }]);
  });

  it('ignores class items whose levels are not a stored number', () => {
    const a = actor('character', {}, [cls('Fighter', 5, 'fighter'), cls('Odd', 'x', 'odd')]);
    const p = actorProgression(a);
    expect(p.level).toBe(5);
    expect(p.classes).toEqual([{ name: 'Fighter', levels: 5 }, { name: 'Odd' }]);
  });

  it('falls back to system.details.level when there are no class items', () => {
    const a = actor('character', { details: { level: 4 } });
    expect(actorProgression(a)).toEqual({ level: 4 });
  });

  it('prefers class items over a stored details.level', () => {
    const a = actor('character', { details: { level: 1 } }, [cls('Fighter', 5, 'fighter')]);
    expect(actorProgression(a).level).toBe(5);
  });

  it('returns no level when nothing is stored', () => {
    expect(actorProgression(actor('character', {}))).toEqual({});
  });

  it('reads the stored CR of an NPC', () => {
    expect(actorProgression(actor('npc', { details: { cr: 0.25 } })).cr).toBe(0.25);
  });

  it('handles a missing items array and system', () => {
    const a = { _id: 'actorAAAAAAAAAAA', name: 'Bare', type: 'npc' } as unknown as WorldActor;
    expect(actorProgression(a)).toEqual({});
  });
});

describe('formatChallengeRating', () => {
  it('prints the fractional CRs as fractions', () => {
    expect(formatChallengeRating(0.125)).toBe('1/8');
    expect(formatChallengeRating(0.25)).toBe('1/4');
    expect(formatChallengeRating(0.5)).toBe('1/2');
  });

  it('prints whole CRs as numbers', () => {
    expect(formatChallengeRating(0)).toBe('0');
    expect(formatChallengeRating(12)).toBe('12');
  });
});
