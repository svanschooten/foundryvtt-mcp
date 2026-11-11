/**
 * @fileoverview Unit tests for get_actor_items — listing and reading owned items
 */

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it, vi } from 'vitest';
import type { FoundryClient } from '../../../foundry/client.js';
import type { WorldItem } from '../../../foundry/types.js';
import { handleGetActorItems } from '../actor-items.js';

const ACTOR_ID = 'actorWizard00001';

/** A dnd5e 3.1 wizard with a homebrew feature, gear and spells. */
const WIZARD_ITEMS: WorldItem[] = [
  {
    _id: 'classWizard00001',
    name: 'Wizard',
    type: 'class',
    system: {
      identifier: 'wizard',
      levels: 5,
      hitDice: 'd6',
      hitDiceUsed: 1,
      spellcasting: { progression: 'full', ability: 'int' },
      description: { value: '<p>A scholarly magic-user.</p>' },
    },
  },
  {
    _id: 'subclassEvoc0001',
    name: 'School of Evocation',
    type: 'subclass',
    system: { identifier: 'evocation', classIdentifier: 'wizard' },
  },
  {
    _id: 'featAuraSelune01',
    name: 'Aura of Selune',
    type: 'feat',
    system: {
      description: {
        value:
          '<h3>Moonlit Ward</h3><p>As a bonus action you shed moonlight &amp; allies within 10 feet gain [[/r 1d4]] temporary hit points.</p><ul><li>Lasts 1 minute.</li></ul>',
      },
      type: { value: 'class', subtype: '' },
      requirements: 'Wizard 3',
      activation: { type: 'bonus', cost: 1, condition: 'while not wearing armor' },
      duration: { value: '1', units: 'minute' },
      range: { value: null, long: null, units: 'self' },
      target: { value: 10, width: null, units: 'ft', type: 'radius' },
      uses: { value: 1, max: '2', per: 'lr', recovery: '' },
      recharge: { value: null, charged: false },
      source: { custom: 'Homebrew' },
    },
  },
  {
    _id: 'featRecharge0001',
    name: 'Arcane Burst',
    type: 'feat',
    system: {
      type: { value: 'monster', subtype: '' },
      recharge: { value: 5, charged: false },
      uses: { value: null, max: '', per: null },
    },
  },
  {
    _id: 'weaponDagger0001',
    name: 'Dagger',
    type: 'weapon',
    system: {
      quantity: 2,
      equipped: true,
      attunement: 0,
      weight: 1,
      price: { value: 2, denomination: 'gp' },
      actionType: 'mwak',
      ability: 'dex',
      damage: { parts: [['1d4 + @mod', 'piercing']], versatile: '' },
      range: { value: 20, long: 60, units: 'ft' },
      activation: { type: 'action', cost: 1, condition: '' },
    },
  },
  {
    _id: 'equipRingProt001',
    name: 'Ring of Protection',
    type: 'equipment',
    system: {
      quantity: 1,
      equipped: true,
      attunement: 2,
      rarity: 'rare',
      uses: { value: 0, max: '', per: null },
    },
  },
  {
    _id: 'equipCloakUnatt1',
    name: 'Cloak of Elvenkind',
    type: 'equipment',
    system: { quantity: 1, equipped: false, attunement: 1, rarity: 'uncommon' },
  },
  {
    _id: 'consumPotion0001',
    name: 'Potion of Healing',
    type: 'consumable',
    system: {
      quantity: 3,
      equipped: false,
      uses: { value: 1, max: '1', per: 'charges', autoDestroy: true },
      damage: { parts: [['2d4 + 2', 'healing']] },
      actionType: 'heal',
    },
  },
  {
    _id: 'spellFireBolt001',
    name: 'Fire Bolt',
    type: 'spell',
    system: {
      level: 0,
      school: 'evo',
      properties: ['vocal', 'somatic'],
      preparation: { mode: 'prepared', prepared: false },
    },
  },
  {
    _id: 'spellShield00001',
    name: 'Shield',
    type: 'spell',
    system: {
      level: 1,
      school: 'abj',
      properties: ['vocal', 'somatic'],
      preparation: { mode: 'prepared', prepared: true },
    },
  },
  {
    _id: 'spellDetectMag01',
    name: 'Detect Magic',
    type: 'spell',
    system: {
      level: 1,
      school: 'div',
      properties: ['vocal', 'somatic', 'concentration', 'ritual'],
      preparation: { mode: 'prepared', prepared: false },
    },
  },
  {
    _id: 'spellFireball001',
    name: 'Fireball',
    type: 'spell',
    system: {
      level: 3,
      school: 'evo',
      properties: ['vocal', 'somatic', 'material'],
      materials: { value: 'a tiny ball of bat guano and sulfur', consumed: false, cost: 0 },
      preparation: { mode: 'always', prepared: false },
      activation: { type: 'action', cost: 1 },
      range: { value: 150, units: 'ft' },
      target: { value: 20, units: 'ft', type: 'sphere' },
      duration: { value: '', units: 'inst' },
      actionType: 'save',
      save: { ability: 'dex', dc: null, scaling: 'spell' },
      damage: { parts: [['8d6', 'fire']] },
      scaling: { mode: 'level', formula: '1d6' },
      description: { value: '<p>A bright streak flashes&hellip;</p>' },
    },
  },
];

function mockClient(items: WorldItem[] = WIZARD_ITEMS) {
  const getActorItems = vi.fn(() => ({
    actor: { _id: ACTOR_ID, name: 'Elara', type: 'character' },
    items,
  }));
  const client = { getActorItems } as unknown as FoundryClient;
  return { client, getActorItems };
}

async function run(args: Record<string, unknown>, items?: WorldItem[]): Promise<string> {
  const { client } = mockClient(items);
  const result = await handleGetActorItems(args as { actorId: string }, client);
  return result.content[0]?.text ?? '';
}

function section(text: string, heading: string): string {
  const start = text.indexOf(heading);
  expect(start, `missing section ${heading}`).toBeGreaterThanOrEqual(0);
  const rest = text.slice(start + heading.length);
  const next = rest.search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('handleGetActorItems', () => {
  describe('validation', () => {
    it('rejects a missing actorId', async () => {
      const { client } = mockClient();
      await expect(handleGetActorItems({ actorId: '' }, client)).rejects.toBeInstanceOf(McpError);
    });

    it.each([
      ['type', ['spell']],
      ['query', 42],
      ['itemId', { id: 'x' }],
    ])('rejects a non-string %s as invalid params', async (key, value) => {
      const { client, getActorItems } = mockClient();
      const error = await handleGetActorItems(
        { actorId: ACTOR_ID, [key]: value } as unknown as { actorId: string },
        client,
      ).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(McpError);
      expect((error as McpError).code).toBe(ErrorCode.InvalidParams);
      expect((error as McpError).message).toContain(key);
      expect(getActorItems).not.toHaveBeenCalled();
    });

    it('surfaces client errors as McpError', async () => {
      const client = {
        getActorItems: vi.fn(() => {
          throw new Error('Actor not found: actorMissing0001');
        }),
      } as unknown as FoundryClient;
      await expect(handleGetActorItems({ actorId: 'actorMissing0001' }, client)).rejects.toThrow(
        /Actor not found/,
      );
    });
  });

  describe('list mode', () => {
    it('names the actor and counts the items', async () => {
      const text = await run({ actorId: ACTOR_ID });
      expect(text).toContain('Elara');
      expect(text).toContain(ACTOR_ID);
      expect(text).toContain(`${WIZARD_ITEMS.length} of ${WIZARD_ITEMS.length} items`);
    });

    it('prints every item id so the write tools can use it', async () => {
      const text = await run({ actorId: ACTOR_ID });
      for (const item of WIZARD_ITEMS) {
        expect(text).toContain(item._id);
      }
    });

    it('groups items by type in a stable order', async () => {
      const text = await run({ actorId: ACTOR_ID });
      const order = ['## Classes', '## Subclasses', '## Features', '## Spells', '## Weapons'];
      const positions = order.map((h) => text.indexOf(h));
      expect(positions.every((p) => p >= 0)).toBe(true);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    });

    it('shows class levels and the subclass link as stored', async () => {
      const text = await run({ actorId: ACTOR_ID });
      expect(section(text, '## Classes')).toMatch(/Wizard.*levels 5/);
      expect(section(text, '## Subclasses')).toMatch(/School of Evocation.*class: wizard/);
    });

    it('shows quantity, equipped and attunement for gear', async () => {
      const text = await run({ actorId: ACTOR_ID });
      expect(section(text, '## Weapons')).toMatch(/Dagger.*qty 2.*equipped/);
      const equipment = section(text, '## Equipment');
      expect(equipment).toMatch(/Ring of Protection.*equipped.*attuned/);
      expect(equipment).toMatch(/Cloak of Elvenkind.*requires attunement \(not attuned\)/);
      expect(equipment).not.toMatch(/Cloak of Elvenkind[^\n]*\bequipped/);
    });

    it('shows stored uses with their recovery period', async () => {
      const text = await run({ actorId: ACTOR_ID });
      expect(section(text, '## Features')).toMatch(/Aura of Selune.*uses 1\/2 per lr/);
      expect(section(text, '## Consumables')).toMatch(/Potion of Healing.*qty 3.*uses 1\/1/);
    });

    it('omits uses when no maximum is stored', async () => {
      const text = await run({ actorId: ACTOR_ID });
      expect(section(text, '## Equipment')).not.toMatch(/Ring of Protection[^\n]*uses/);
    });

    it('shows feature type, requirements and recharge', async () => {
      const features = section(await run({ actorId: ACTOR_ID }), '## Features');
      expect(features).toMatch(/Aura of Selune.*type class.*requires Wizard 3/);
      expect(features).toMatch(/Arcane Burst.*recharge 5/);
    });

    it('groups spells by level with cantrips first', async () => {
      const spells = section(await run({ actorId: ACTOR_ID }), '## Spells');
      const cantrips = spells.indexOf('### Cantrips');
      const first = spells.indexOf('### Level 1');
      const third = spells.indexOf('### Level 3');
      expect(cantrips).toBeGreaterThanOrEqual(0);
      expect(first).toBeGreaterThan(cantrips);
      expect(third).toBeGreaterThan(first);
      expect(spells.indexOf('Fire Bolt')).toBeLessThan(first);
      expect(spells.indexOf('Fireball')).toBeGreaterThan(third);
    });

    it('shows spell school, preparation and components as stored', async () => {
      const spells = section(await run({ actorId: ACTOR_ID }), '## Spells');
      expect(spells).toMatch(/Shield.*school abj.*prepared \(mode: prepared\)/);
      expect(spells).toMatch(/Detect Magic.*not prepared.*ritual.*concentration/);
      expect(spells).toMatch(/Fireball.*school evo.*mode: always/);
    });

    it('filters by type, case-insensitively', async () => {
      const text = await run({ actorId: ACTOR_ID, type: 'Spell' });
      expect(text).toContain('Fireball');
      expect(text).not.toContain('Dagger');
      expect(text).toContain('4 of 12 items');
    });

    it('filters by a name query', async () => {
      const text = await run({ actorId: ACTOR_ID, query: 'fire' });
      expect(text).toContain('Fire Bolt');
      expect(text).toContain('Fireball');
      expect(text).not.toContain('Shield');
    });

    it('lists the types present when a filter matches nothing', async () => {
      const text = await run({ actorId: ACTOR_ID, type: 'tool' });
      expect(text).toMatch(/No items match/);
      expect(text).toMatch(/Types owned: .*spell/);
    });

    it('says so when the actor owns nothing', async () => {
      const text = await run({ actorId: ACTOR_ID }, []);
      expect(text).toMatch(/owns no items/);
    });

    it('prints unknown item types under their own heading', async () => {
      const text = await run({ actorId: ACTOR_ID }, [
        { _id: 'otherItem0000001', name: 'Odd Thing', type: 'vehicleThing', system: {} },
      ]);
      expect(text).toContain('## vehicleThing');
      expect(text).toContain('Odd Thing');
    });
  });

  describe('single-item mode (itemId)', () => {
    it('returns the full description converted to text', async () => {
      const text = await run({ actorId: ACTOR_ID, itemId: 'featAuraSelune01' });
      expect(text).toContain('Aura of Selune');
      expect(text).toContain('### Moonlit Ward');
      expect(text).toContain('shed moonlight & allies');
      expect(text).toContain('gain 1d4 temporary');
      expect(text).toContain('- Lasts 1 minute.');
      expect(text).not.toContain('<p>');
    });

    it('returns activation, range, target, duration, uses, requirements and source', async () => {
      const text = await run({ actorId: ACTOR_ID, itemId: 'featAuraSelune01' });
      expect(text).toMatch(/Activation:\*\* 1 bonus \(while not wearing armor\)/);
      expect(text).toMatch(/Range:\*\* self/);
      expect(text).toMatch(/Target:\*\* 10 ft radius/);
      expect(text).toMatch(/Duration:\*\* 1 minute/);
      expect(text).toMatch(/Uses:\*\* 1\/2 per lr/);
      expect(text).toMatch(/Requirements:\*\* Wizard 3/);
      expect(text).toMatch(/Source:\*\* Homebrew/);
    });

    it('returns damage formulas and weapon details as stored', async () => {
      const text = await run({ actorId: ACTOR_ID, itemId: 'weaponDagger0001' });
      expect(text).toMatch(/Damage:\*\* 1d4 \+ @mod piercing/);
      expect(text).toMatch(/Range:\*\* 20\/60 ft/);
      expect(text).toMatch(/Action type:\*\* mwak/);
      expect(text).toMatch(/Price:\*\* 2 gp/);
      expect(text).toMatch(/Weight:\*\* 1/);
    });

    it('returns spell details', async () => {
      const text = await run({ actorId: ACTOR_ID, itemId: 'spellFireball001' });
      expect(text).toMatch(/Level:\*\* 3/);
      expect(text).toMatch(/School:\*\* evo/);
      expect(text).toMatch(/Components:\*\* vocal, somatic, material/);
      expect(text).toMatch(/Materials:\*\* a tiny ball of bat guano and sulfur/);
      expect(text).toMatch(/Save:\*\* dex/);
      expect(text).toMatch(/Damage:\*\* 8d6 fire/);
      expect(text).toMatch(/Duration:\*\* inst/);
      expect(text).toContain('A bright streak flashes…');
    });

    describe('dnd5e 3.x stored combat values', () => {
      const LONGSWORD: WorldItem = {
        _id: 'weaponLongsw0001',
        name: 'Longsword +1',
        type: 'weapon',
        system: {
          quantity: 1,
          equipped: true,
          proficient: 1,
          ability: 'str',
          actionType: 'mwak',
          attackBonus: '@abilities.str.mod',
          magicalBonus: 1,
          properties: ['mgc', 'ver'],
          damage: { parts: [['1d8 + @mod', 'slashing']], versatile: '1d10 + @mod' },
        },
      };
      const PLATE: WorldItem = {
        _id: 'equipPlate000001',
        name: 'Plate Armor +1',
        type: 'equipment',
        system: {
          quantity: 1,
          equipped: true,
          proficient: null,
          type: { value: 'heavy', baseItem: 'plate' },
          armor: { value: 18, dex: 0, magicalBonus: 1 },
          strength: 15,
        },
      };
      const SHIELD: WorldItem = {
        _id: 'equipShield00001',
        name: 'Shield',
        type: 'equipment',
        system: { type: { value: 'shield' }, armor: { value: 2, dex: null, magicalBonus: null } },
      };

      it('returns attack bonus, magical bonus and proficiency', async () => {
        const text = await run({ actorId: ACTOR_ID, itemId: LONGSWORD._id }, [LONGSWORD]);
        expect(text).toMatch(/Attack:\*\* ability str bonus @abilities\.str\.mod/);
        expect(text).toMatch(/Magical bonus:\*\* \+1/);
        expect(text).toMatch(/Proficient:\*\* yes/);
      });

      it('returns armor value, dex cap, magical bonus and strength requirement', async () => {
        const text = await run({ actorId: ACTOR_ID, itemId: PLATE._id }, [PLATE]);
        expect(text).toMatch(/Armor:\*\* AC 18, max dex 0, magical bonus \+1/);
        expect(text).toMatch(/Strength required:\*\* 15/);
        // null proficiency means "worked out by the system" — nothing stored to show
        expect(text).not.toMatch(/Proficient/);
      });

      it('shows armor class and magical bonus in the list', async () => {
        const text = await run({ actorId: ACTOR_ID }, [LONGSWORD, PLATE, SHIELD]);
        expect(section(text, '## Weapons')).toMatch(/Longsword \+1.*\+1 magical/);
        const equipment = section(text, '## Equipment');
        expect(equipment).toMatch(/Plate Armor \+1.*AC 18.*\+1 magical/);
        expect(equipment).toMatch(/Shield.*AC 2/);
      });
    });

    it('says when an item has no stored description', async () => {
      const text = await run({ actorId: ACTOR_ID, itemId: 'spellShield00001' });
      expect(text).toMatch(/Description:\*\* not stored/);
    });

    it('rejects an itemId the actor does not own', async () => {
      const { client } = mockClient();
      await expect(
        handleGetActorItems({ actorId: ACTOR_ID, itemId: 'nopeNopeNope0001' }, client),
      ).rejects.toThrow(/does not own an item with id nopeNopeNope0001/);
    });

    it('reads dnd5e 4.x items: spent uses and activities', async () => {
      const text = await run({ actorId: ACTOR_ID, itemId: 'featV4Channel001' }, [
        {
          _id: 'featV4Channel001',
          name: 'Channel Divinity',
          type: 'feat',
          system: {
            uses: { spent: 1, max: '3', recovery: [{ period: 'sr', type: 'recoverAll' }] },
            activities: {
              act1: {
                _id: 'act1',
                type: 'save',
                name: 'Turn Undead',
                activation: { type: 'action', value: 1 },
                range: { units: 'self' },
                target: { template: { type: 'radius', size: '30', units: 'ft' } },
                duration: { value: '1', units: 'minute' },
                save: { ability: ['wis'], dc: { calculation: 'spellcasting', formula: '' } },
                damage: { parts: [{ number: 2, denomination: 6, bonus: '', types: ['radiant'] }] },
              },
            },
          },
        },
      ]);
      expect(text).toMatch(/Uses:\*\* 1 spent of 3 per sr/);
      expect(text).toContain('Turn Undead');
      expect(text).toMatch(/save/);
      expect(text).toMatch(/1 action/);
      expect(text).toMatch(/30 ft radius/);
      expect(text).toMatch(/wis/);
      expect(text).toMatch(/2d6 radiant/);
    });

    it('lists uses for a 4.x item in list mode too', async () => {
      const text = await run({ actorId: ACTOR_ID }, [
        {
          _id: 'featV4Channel001',
          name: 'Channel Divinity',
          type: 'feat',
          system: { uses: { spent: 1, max: '3', recovery: [{ period: 'sr' }] } },
        },
      ]);
      expect(text).toMatch(/Channel Divinity.*uses 1 spent of 3 per sr/);
    });
  });
});
