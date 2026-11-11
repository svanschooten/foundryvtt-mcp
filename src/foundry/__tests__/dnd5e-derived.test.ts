/**
 * @fileoverview Unit tests for the optional dnd5e derived-stat calculation
 */

import { describe, expect, it } from 'vitest';
import { formatChallengeRating } from '../actor-progression.js';
import { dnd5eDerivedStats } from '../dnd5e-derived.js';
import type { WorldActor, WorldItem } from '../types.js';

function ability(value: number, proficient = 0, bonuses: Record<string, string> = {}) {
  return { value, proficient, bonuses: { check: '', save: '', ...bonuses } };
}

function cls(levels: number): WorldItem {
  return {
    _id: `classItem${levels}`.padEnd(16, '0'),
    name: 'Monk',
    type: 'class',
    system: { identifier: 'monk', levels },
  };
}

/** Azura-like: Monk 8 / Fighter 3 is level 11, proficiency +4. */
function character(overrides: Partial<WorldActor> = {}, system: Record<string, unknown> = {}) {
  return {
    _id: 'actorAzura000001',
    name: 'Azura',
    type: 'character',
    items: [cls(8), { ...cls(3), _id: 'classFighter0001', name: 'Fighter' }],
    system: {
      abilities: {
        str: ability(9, 1),
        dex: ability(20, 1),
        con: ability(14),
        int: ability(9),
        wis: ability(16),
        cha: ability(7),
      },
      skills: {
        acr: { ability: 'dex', value: 1, bonuses: { check: '', passive: '' } },
        ste: { ability: 'dex', value: 2, bonuses: { check: '', passive: '' } },
        prc: { ability: 'wis', value: 1, bonuses: { check: '', passive: '' } },
        ath: { ability: 'str', value: 0, bonuses: { check: '', passive: '' } },
        arc: { ability: 'int', value: 0, bonuses: { check: '', passive: '' } },
      },
      ...system,
    },
    ...overrides,
  } as WorldActor;
}

function abilityRow(stats: ReturnType<typeof dnd5eDerivedStats>, key: string) {
  return stats.abilities.find((a) => a.key === key);
}

function skillRow(stats: ReturnType<typeof dnd5eDerivedStats>, key: string) {
  return stats.skills.find((s) => s.key === key);
}

describe('dnd5eDerivedStats', () => {
  it('works out ability modifiers from stored scores', () => {
    const stats = dnd5eDerivedStats(character());
    expect(abilityRow(stats, 'str')?.mod).toBe(-1);
    expect(abilityRow(stats, 'dex')?.mod).toBe(5);
    expect(abilityRow(stats, 'con')?.mod).toBe(2);
    expect(abilityRow(stats, 'cha')?.mod).toBe(-2);
  });

  it('takes the proficiency bonus from the summed class levels', () => {
    expect(dnd5eDerivedStats(character()).proficiency).toEqual({ bonus: 4, source: 'level 11' });
  });

  it.each([
    [1, 2],
    [4, 2],
    [5, 3],
    [9, 4],
    [13, 5],
    [17, 6],
    [20, 6],
  ])('level %i gives proficiency +%i', (level, bonus) => {
    const stats = dnd5eDerivedStats(character({ items: [cls(level)] }));
    expect(stats.proficiency?.bonus).toBe(bonus);
  });

  it.each([
    [0, 2],
    [0.25, 2],
    [4, 2],
    [5, 3],
    [16, 5],
    [21, 7],
    [30, 9],
  ])('an NPC of CR %s gives proficiency +%i', (cr, bonus) => {
    const npc = character({ type: 'npc', items: [] }, { details: { cr } });
    expect(dnd5eDerivedStats(npc).proficiency).toEqual({
      bonus,
      source: `CR ${formatChallengeRating(cr)}`,
    });
  });

  it('adds proficiency to proficient saves only', () => {
    const stats = dnd5eDerivedStats(character());
    expect(abilityRow(stats, 'dex')).toMatchObject({ save: 9, saveProficient: true });
    expect(abilityRow(stats, 'str')).toMatchObject({ save: 3, saveProficient: true });
    expect(abilityRow(stats, 'wis')).toMatchObject({ save: 3, saveProficient: false });
  });

  it('works out skills with proficiency and expertise', () => {
    const stats = dnd5eDerivedStats(character());
    expect(skillRow(stats, 'acr')).toMatchObject({ total: 9, proficiency: 1, ability: 'dex' });
    expect(skillRow(stats, 'ste')).toMatchObject({ total: 13, proficiency: 2 });
    expect(skillRow(stats, 'ath')).toMatchObject({ total: -1, proficiency: 0 });
  });

  it('works out passive Perception', () => {
    expect(dnd5eDerivedStats(character()).passivePerception).toBe(17);
  });

  it('applies Jack of All Trades (half, rounded down) to skills without proficiency', () => {
    const bard = character({ flags: { dnd5e: { jackOfAllTrades: true } } });
    const stats = dnd5eDerivedStats(bard);
    expect(skillRow(stats, 'arc')?.total).toBe(-1 + 2);
    expect(skillRow(stats, 'acr')?.total).toBe(9);
  });

  it('applies Remarkable Athlete (half, rounded up) to STR, DEX and CON skills', () => {
    const stats = dnd5eDerivedStats(
      character({ items: [cls(5)], flags: { dnd5e: { remarkableAthlete: true } } }),
    );
    // proficiency +3, half rounded up is 2
    expect(skillRow(stats, 'ath')?.total).toBe(-1 + 2);
    expect(skillRow(stats, 'arc')?.total).toBe(-1);
  });

  it('adds +5 to passive Perception for the Observant feat', () => {
    const stats = dnd5eDerivedStats(character({ flags: { dnd5e: { observantFeat: true } } }));
    expect(stats.passivePerception).toBe(22);
  });

  it('adds flat stored bonuses and lists formula bonuses as not applied', () => {
    const stats = dnd5eDerivedStats(
      character(
        {},
        {
          abilities: {
            ...character().system.abilities,
            con: ability(14, 0, { save: '+2' }),
          },
          bonuses: { abilities: { save: '1d4', check: '1', skill: '' } },
        },
      ),
    );
    // con save: mod 2 + flat 2; the global 1d4 is not applied
    expect(abilityRow(stats, 'con')?.save).toBe(4);
    // acr: 9 + global check bonus 1
    expect(skillRow(stats, 'acr')?.total).toBe(10);
    expect(stats.notApplied.join(' ')).toContain('1d4');
  });

  it('names active effects that change abilities, skills or bonuses as not applied', () => {
    const stats = dnd5eDerivedStats(
      character({
        effects: [
          {
            _id: 'effectBless00001',
            name: 'Bless',
            changes: [{ key: 'system.bonuses.abilities.save', mode: 2, value: '1d4' }],
          },
          {
            _id: 'effectSpeed00001',
            name: 'Longstrider',
            changes: [{ key: 'system.attributes.movement.walk', mode: 2, value: '10' }],
          },
          {
            _id: 'effectOff0000001',
            name: 'Disabled one',
            disabled: true,
            changes: [{ key: 'system.abilities.str.value', mode: 5, value: '19' }],
          },
        ],
        items: [
          cls(11),
          {
            _id: 'itemBelt00000001',
            name: 'Belt of Giant Strength',
            type: 'equipment',
            system: { equipped: true },
            effects: [
              {
                _id: 'effectBelt000001',
                name: 'Hill Giant Strength',
                changes: [{ key: 'system.abilities.str.value', mode: 4, value: '21' }],
              },
            ],
          },
          {
            _id: 'itemCloak0000001',
            name: 'Cloak of Protection',
            type: 'equipment',
            system: { equipped: false },
            effects: [
              {
                _id: 'effectCloak00001',
                name: 'Cloak bonus',
                changes: [{ key: 'system.bonuses.abilities.save', mode: 2, value: '1' }],
              },
            ],
          },
        ],
      }),
    );
    const notes = stats.notApplied.join(' ');
    expect(notes).toContain('Bless');
    expect(notes).toContain('Hill Giant Strength');
    expect(notes).not.toContain('Longstrider');
    expect(notes).not.toContain('Disabled one');
    expect(notes).not.toContain('Cloak bonus');
  });

  it('skips effects of items that need attunement but are not attuned', () => {
    const item = (id: string, name: string, system: Record<string, unknown>): WorldItem => ({
      _id: id,
      name,
      type: 'equipment',
      system: { equipped: true, ...system },
      effects: [
        {
          _id: `${id}fx`.slice(0, 16),
          name: `${name} effect`,
          changes: [{ key: 'system.abilities.con.value', mode: 5, value: '19' }],
        },
      ],
    });
    const notes = dnd5eDerivedStats(
      character({
        items: [
          cls(11),
          item('itemAmulet000001', 'Amulet 3.0', { attunement: 1 }),
          item('itemAmulet000002', 'Amulet 3.0 attuned', { attunement: 2 }),
          item('itemAmulet000003', 'Amulet 3.2', { attunement: 'required', attuned: false }),
          item('itemAmulet000004', 'Amulet 3.2 attuned', { attunement: 'required', attuned: true }),
        ],
      }),
    ).notApplied.join(' ');
    expect(notes).not.toContain('Amulet 3.0 effect');
    expect(notes).toContain('Amulet 3.0 attuned effect');
    expect(notes).not.toContain('Amulet 3.2 effect');
    expect(notes).toContain('Amulet 3.2 attuned effect');
  });

  it('leaves out saves and skills when no level or CR is stored', () => {
    const stats = dnd5eDerivedStats(character({ items: [] }));
    expect(stats.proficiency).toBeUndefined();
    expect(abilityRow(stats, 'dex')?.mod).toBe(5);
    expect(abilityRow(stats, 'dex')?.save).toBeUndefined();
    expect(stats.skills).toEqual([]);
    expect(stats.passivePerception).toBeUndefined();
    expect(stats.notApplied.join(' ')).toMatch(/proficiency/i);
  });

  it('skips abilities with no stored score', () => {
    const stats = dnd5eDerivedStats(
      character({}, { abilities: { dex: ability(20, 1), str: { proficient: 0 } } }),
    );
    expect(stats.abilities.map((a) => a.key)).toEqual(['dex']);
  });
});
