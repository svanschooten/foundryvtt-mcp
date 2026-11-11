/**
 * @fileoverview Formats stored item documents (owned or world items) as text.
 *
 * Principle: show what FoundryVTT stores; do not re-implement game rules.
 * Values that a game system derives in the browser (attack bonus, save DC,
 * `uses.value` in dnd5e 4.x, labels) are not in the stored data and are never
 * computed here. Formulas are printed as stored (`1d4 + @mod`, `@prof`).
 *
 * The field paths are dnd5e's — 3.x (`system.uses.per`, `damage.parts` as
 * `[formula, type]` pairs, numeric `attunement`) and 4.x (`uses.spent`,
 * `uses.recovery[]`, `activities`). Each reader checks the shape it finds, so
 * an item from another game system degrades to name, type, id and description.
 * Keep dnd5e-specific lookups in this file so they are easy to revisit after a
 * system upgrade.
 */

import type { WorldItem } from '../../foundry/types.js';
import { htmlToText } from '../../utils/html-to-text.js';

type Rec = Record<string, unknown>;

function rec(value: unknown): Rec | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Rec)
    : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** A stored scalar (number or non-empty string) as text. */
function scalar(value: unknown): string | undefined {
  const n = num(value);
  return n !== undefined ? String(n) : str(value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function joinParts(...parts: Array<string | undefined>): string | undefined {
  const kept = parts.filter((p): p is string => p !== undefined && p !== '');
  return kept.length > 0 ? kept.join(' ') : undefined;
}

// ============================================================================
// Field readers — each returns undefined when nothing meaningful is stored
// ============================================================================

/** Limited uses: 3.x `value/max per`, 4.x `spent` of `max` with `recovery[]`. */
export function describeUses(system: Rec): string | undefined {
  const uses = rec(system.uses);
  if (!uses) {
    return undefined;
  }
  const max = scalar(uses.max);
  if (max === undefined || max === '0') {
    return undefined;
  }
  const recovery = Array.isArray(uses.recovery) ? rec(uses.recovery[0]) : undefined;
  const period = str(uses.per) ?? str(recovery?.period);
  // dnd5e 3.x stores per: 'charges' for uses that never recover on rest.
  const per = period === 'charges' ? ' charges' : period ? ` per ${period}` : '';
  const value = num(uses.value);
  if (value !== undefined) {
    return `${value}/${max}${per}`;
  }
  const spent = num(uses.spent);
  if (spent !== undefined) {
    return `${spent} spent of ${max}${per}`;
  }
  return `max ${max}${per} (current value not stored)`;
}

/** Attunement: 3.0–3.1 numeric enum (0 none, 1 required, 2 attuned); 3.2+ string + `attuned`. */
export function describeAttunement(system: Rec): string | undefined {
  const attunement = system.attunement;
  const attuned = system.attuned === true;
  if (typeof attunement === 'number') {
    if (attunement === 2) {
      return 'attuned';
    }
    if (attunement === 1) {
      return 'requires attunement (not attuned)';
    }
    return undefined;
  }
  if (attunement === 'required' || attunement === 'optional') {
    if (attuned) {
      return 'attuned';
    }
    return attunement === 'required'
      ? 'requires attunement (not attuned)'
      : 'attunement optional (not attuned)';
  }
  return attuned ? 'attuned' : undefined;
}

function describeRecharge(system: Rec): string | undefined {
  const recharge = rec(system.recharge);
  const value = num(recharge?.value);
  if (value === undefined) {
    return undefined;
  }
  return `recharge ${value} (${recharge?.charged === true ? 'charged' : 'not charged'})`;
}

/** Spell preparation: 3.x/4.x `preparation {mode, prepared}`, 5.x `method` + numeric `prepared`. */
function describePreparation(system: Rec): string | undefined {
  const prep = rec(system.preparation);
  if (prep) {
    const mode = str(prep.mode);
    if (mode === undefined || mode === 'prepared') {
      if (typeof prep.prepared !== 'boolean') {
        return mode ? `mode: ${mode}` : undefined;
      }
      return `${prep.prepared ? 'prepared' : 'not prepared'} (mode: prepared)`;
    }
    return `mode: ${mode}`;
  }
  const method = str(system.method);
  const prepared = num(system.prepared);
  const state =
    prepared === 2
      ? 'always prepared'
      : prepared === 1
        ? 'prepared'
        : prepared === 0
          ? 'not prepared'
          : undefined;
  return joinParts(state, method ? `(method: ${method})` : undefined);
}

const SPELL_COMPONENTS = ['vocal', 'somatic', 'material', 'concentration', 'ritual'] as const;

/** Spell components: 3.x+ stores them in `properties`; 2.x in a `components` object. */
function spellComponents(system: Rec): string[] {
  const props = new Set(strings(system.properties));
  const legacy = rec(system.components);
  return SPELL_COMPONENTS.filter((c) => props.has(c) || legacy?.[c] === true);
}

function describeCategory(system: Rec): string | undefined {
  const type = rec(system.type);
  if (!type) {
    return undefined;
  }
  const value = str(type.value);
  const subtype = str(type.subtype);
  const base = str(type.baseItem);
  return joinParts(
    value && subtype ? `${value}/${subtype}` : value,
    base ? `(base item: ${base})` : undefined,
  );
}

function describeActivation(activation: unknown): string | undefined {
  const a = rec(activation);
  const type = str(a?.type);
  if (!a || !type || type === 'none') {
    return undefined;
  }
  const condition = str(a.condition);
  return joinParts(scalar(a.cost) ?? scalar(a.value), type, condition && `(${condition})`);
}

function describeRange(range: unknown): string | undefined {
  const r = rec(range);
  if (!r) {
    return undefined;
  }
  const value = scalar(r.value);
  const long = scalar(r.long);
  const distance = value && long ? `${value}/${long}` : value;
  return joinParts(distance, str(r.units), str(r.special));
}

function describeTarget(target: unknown): string | undefined {
  const t = rec(target);
  if (!t) {
    return undefined;
  }
  const template = rec(t.template);
  const affects = rec(t.affects);
  if (template || affects) {
    // dnd5e 4.x activity target
    const area = template
      ? joinParts(
          scalar(template.count),
          scalar(template.size),
          str(template.units),
          str(template.type),
        )
      : undefined;
    const who = affects ? joinParts(scalar(affects.count), str(affects.type)) : undefined;
    const parts = [area, who && `affects ${who}`].filter(Boolean);
    return parts.length > 0 ? parts.join('; ') : undefined;
  }
  const width = scalar(t.width);
  return joinParts(scalar(t.value), str(t.units), str(t.type), width && `(width ${width})`);
}

function describeDuration(duration: unknown): string | undefined {
  const d = rec(duration);
  if (!d) {
    return undefined;
  }
  return joinParts(
    scalar(d.value),
    str(d.units),
    d.concentration === true ? '(concentration)' : undefined,
    str(d.special),
  );
}

/** One damage part: 3.x `[formula, type]`, 4.x `{number, denomination, bonus, types, custom}`. */
function describeDamagePart(part: unknown): string | undefined {
  if (Array.isArray(part)) {
    return joinParts(str(part[0]), str(part[1]));
  }
  const p = rec(part);
  if (!p) {
    return str(part);
  }
  const types = strings(p.types).join('/') || undefined;
  const custom = rec(p.custom);
  if (custom?.enabled === true && str(custom.formula)) {
    return joinParts(str(custom.formula), types);
  }
  const number = num(p.number);
  const die = num(p.denomination);
  const dice = die ? `${number ?? 1}d${die}` : undefined;
  const bonus = str(p.bonus);
  const formula = dice && bonus ? `${dice} + ${bonus}` : (dice ?? bonus);
  return formula ? joinParts(formula, types) : undefined;
}

function describeDamage(damage: unknown): string | undefined {
  const d = rec(damage);
  if (!d) {
    return undefined;
  }
  const parts = [d.base, ...(Array.isArray(d.parts) ? d.parts : [])]
    .map(describeDamagePart)
    .filter((p): p is string => p !== undefined);
  return parts.length > 0 ? parts.join('; ') : undefined;
}

function describeSave(save: unknown): string | undefined {
  const s = rec(save);
  if (!s) {
    return undefined;
  }
  const abilities = Array.isArray(s.ability) ? strings(s.ability).join('/') : str(s.ability);
  if (!abilities) {
    return undefined;
  }
  const dc = rec(s.dc);
  if (dc) {
    // 4.x: { calculation, formula }
    const formula = str(dc.formula);
    const calc = str(dc.calculation);
    return joinParts(abilities, formula ? `DC ${formula}` : calc && `(DC from ${calc})`);
  }
  const flat = num(s.dc);
  const scaling = str(s.scaling);
  return joinParts(
    abilities,
    flat !== undefined ? `DC ${flat}` : scaling && `(DC from ${scaling})`,
  );
}

/**
 * Attack as stored: 4.x `attack {type, ability, bonus, flat}`; 3.x keeps the
 * ability and bonus on the item (`ability`, `attackBonus`), passed in here.
 */
function describeAttack(attack: unknown, ability?: string, legacyBonus?: string) {
  const a = rec(attack);
  const bonus = str(a?.bonus) ?? legacyBonus;
  const type = rec(a?.type);
  return joinParts(
    joinParts(str(type?.value), str(type?.classification)),
    (str(a?.ability) ?? ability) && `ability ${str(a?.ability) ?? ability}`,
    bonus && `bonus ${bonus}${a?.flat === true ? ' (flat)' : ''}`,
  );
}

function describeSource(source: unknown): string | undefined {
  const s = rec(source);
  if (!s) {
    return str(source);
  }
  const page = scalar(s.page);
  return str(s.custom) ?? joinParts(str(s.book), page && `p. ${page}`);
}

function describeWeight(weight: unknown): string | undefined {
  const w = rec(weight);
  if (w) {
    const value = num(w.value);
    return value ? joinParts(String(value), str(w.units)) : undefined;
  }
  const value = num(weight);
  return value ? String(value) : undefined;
}

function signed(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

/** Stored non-zero `magicalBonus` (weapons: `system`, armor: `system.armor`). */
function magicalBonus(system: Rec): number | undefined {
  const bonus = num(system.magicalBonus) ?? num(rec(system.armor)?.magicalBonus);
  return bonus ? bonus : undefined;
}

/** Stored armor value (AC) when it is set; non-armor equipment stores none or 0. */
function armorValue(system: Rec): number | undefined {
  const value = num(rec(system.armor)?.value);
  return value ? value : undefined;
}

function describeArmor(system: Rec): string | undefined {
  const value = armorValue(system);
  if (value === undefined) {
    return undefined;
  }
  const armor = rec(system.armor);
  const dex = num(armor?.dex);
  const bonus = num(armor?.magicalBonus);
  return [
    `AC ${value}`,
    dex !== undefined ? `max dex ${dex}` : undefined,
    bonus ? `magical bonus ${signed(bonus)}` : undefined,
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * Stored proficiency override. dnd5e stores `null` when the system works it
 * out itself, which is a calculated value and so not shown.
 */
function describeProficient(value: unknown): string | undefined {
  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no';
  }
  const n = num(value);
  if (n === undefined) {
    return undefined;
  }
  return n === 0 ? 'no' : n === 1 ? 'yes' : String(n);
}

function describePrice(price: unknown): string | undefined {
  const p = rec(price);
  const value = num(p?.value);
  return value ? joinParts(String(value), str(p?.denomination)) : undefined;
}

/** dnd5e 4.x activities — the per-use mechanics of an item. */
function describeActivities(system: Rec): string[] {
  const activities = rec(system.activities);
  if (!activities) {
    return [];
  }
  return Object.entries(activities)
    .map(([id, raw]) => [id, rec(raw)] as const)
    .filter((entry): entry is readonly [string, Rec] => entry[1] !== undefined)
    .sort(([, a], [, b]) => (num(a.sort) ?? 0) - (num(b.sort) ?? 0))
    .map(([id, a]) => {
      const name = str(a.name) ?? str(a.type) ?? id;
      const healing = describeDamagePart(a.healing);
      const details = [
        ['activation', describeActivation(a.activation)],
        ['range', describeRange(a.range)],
        ['target', describeTarget(a.target)],
        ['duration', describeDuration(a.duration)],
        ['attack', a.type === 'attack' ? describeAttack(a.attack) : undefined],
        ['save', describeSave(a.save)],
        ['damage', describeDamage(a.damage)],
        ['healing', healing],
        ['uses', describeUses(a)],
      ]
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k} ${v}`);
      const type = str(a.type);
      const head = `- **${name}**${type ? ` (${type})` : ''}`;
      return details.length > 0 ? `${head} — ${details.join('; ')}` : head;
    });
}

// ============================================================================
// Public formatters
// ============================================================================

function systemOf(item: WorldItem): Rec {
  return rec(item.system) ?? {};
}

/** Spell level as stored, or undefined for non-spells / missing level. */
export function spellLevel(item: WorldItem): number | undefined {
  return num(systemOf(item).level);
}

/**
 * One-line summary of an item for a list: name, id and the stored fields that
 * matter at the table. `containerNames` maps item ids to names so items inside
 * a container can say where they are.
 */
export function formatItemSummary(
  item: WorldItem,
  containerNames: ReadonlyMap<string, string> = new Map(),
): string {
  const sys = systemOf(item);
  const parts: Array<string | undefined> = [];

  switch (item.type) {
    case 'class': {
      const levels = num(sys.levels);
      parts.push(levels !== undefined ? `levels ${levels}` : 'levels not stored');
      break;
    }
    case 'subclass':
      parts.push(str(sys.classIdentifier) && `class: ${str(sys.classIdentifier)}`);
      break;
    case 'spell': {
      const components = spellComponents(sys);
      parts.push(
        str(sys.school) && `school ${str(sys.school)}`,
        describePreparation(sys),
        components.includes('ritual') ? 'ritual' : undefined,
        components.includes('concentration') ? 'concentration' : undefined,
      );
      break;
    }
    case 'feat': {
      const requirements = str(sys.requirements);
      parts.push(
        describeCategory(sys) && `type ${describeCategory(sys)}`,
        requirements && `requires ${requirements}`,
      );
      break;
    }
  }

  const quantity = num(sys.quantity);
  const container = str(sys.container);
  const armor = armorValue(sys);
  const bonus = magicalBonus(sys);
  parts.push(
    armor !== undefined ? `AC ${armor}` : undefined,
    bonus !== undefined ? `${signed(bonus)} magical` : undefined,
    quantity !== undefined ? `qty ${quantity}` : undefined,
    sys.equipped === true ? 'equipped' : undefined,
    describeAttunement(sys),
    sys.identified === false ? 'unidentified' : undefined,
    describeUses(sys) && `uses ${describeUses(sys)}`,
    describeRecharge(sys),
    container && `in ${containerNames.get(container) ?? `container ${container}`}`,
  );

  const kept = parts.filter((p): p is string => p !== undefined && p !== '');
  const head = `- **${item.name}** \`${item._id}\``;
  return kept.length > 0 ? `${head} — ${kept.join(', ')}` : head;
}

/**
 * Full stored detail of one item: every table-relevant field that is set, plus
 * the description converted from HTML. Fields that are not stored are left out,
 * except the description, which says so explicitly.
 */
export function formatItemDetails(
  item: WorldItem,
  containerNames: ReadonlyMap<string, string> = new Map(),
): string {
  const sys = systemOf(item);
  const lines: string[] = [`### ${item.name}`, `**Item ID:** \`${item._id}\``];
  const add = (label: string, value: string | undefined) => {
    if (value !== undefined && value !== '') {
      lines.push(`**${label}:** ${value}`);
    }
  };

  add('Type', item.type);
  add('Category', describeCategory(sys));

  // Class / subclass
  if (item.type === 'class') {
    add('Levels', scalar(sys.levels) ?? 'not stored');
    const hd = rec(sys.hd);
    const hitDice = str(sys.hitDice) ?? str(hd?.denomination);
    const used = num(sys.hitDiceUsed) ?? num(hd?.spent);
    add(
      'Hit dice',
      hitDice && joinParts(hitDice, used !== undefined ? `(${used} used)` : undefined),
    );
  }
  add('Identifier', str(sys.identifier));
  add('Class', str(sys.classIdentifier));
  const spellcasting = rec(sys.spellcasting);
  const progression = str(spellcasting?.progression);
  if (progression && progression !== 'none') {
    const ability = str(spellcasting?.ability);
    add('Spellcasting', joinParts(progression, ability && `(${ability})`));
  }

  // Spell
  if (item.type === 'spell') {
    add('Level', scalar(sys.level) ?? 'not stored');
    add('School', str(sys.school));
    add('Components', spellComponents(sys).join(', ') || undefined);
    const materials = rec(sys.materials);
    const cost = num(materials?.cost);
    add(
      'Materials',
      str(materials?.value) &&
        joinParts(
          str(materials?.value),
          cost ? `(cost ${cost})` : undefined,
          materials?.consumed === true ? '(consumed)' : undefined,
        ),
    );
    add('Preparation', describePreparation(sys));
    const scaling = rec(sys.scaling);
    const scalingMode = str(scaling?.mode);
    if (scalingMode && scalingMode !== 'none') {
      add('Scaling', joinParts(scalingMode, str(scaling?.formula)));
    }
  }

  // Physical item
  add('Quantity', scalar(sys.quantity));
  if (typeof sys.equipped === 'boolean') {
    add('Equipped', sys.equipped ? 'yes' : 'no');
  }
  add('Attunement', describeAttunement(sys));
  if (sys.identified === false) {
    add('Identified', 'no');
  }
  add('Armor', describeArmor(sys));
  const strength = num(sys.strength);
  add('Strength required', strength ? String(strength) : undefined);
  const bonus = num(sys.magicalBonus);
  add('Magical bonus', bonus ? signed(bonus) : undefined);
  add('Proficient', describeProficient(sys.proficient));
  add('Rarity', str(sys.rarity));
  add('Price', describePrice(sys.price));
  add('Weight', describeWeight(sys.weight));
  const container = str(sys.container);
  add('Container', container && (containerNames.get(container) ?? container));

  // Usage
  add('Uses', describeUses(sys));
  add('Recharge', describeRecharge(sys)?.replace(/^recharge /, ''));
  add('Requirements', str(sys.requirements));
  add('Activation', describeActivation(sys.activation));
  add('Range', describeRange(sys.range));
  add('Target', describeTarget(sys.target));
  add('Duration', describeDuration(sys.duration));
  add('Action type', str(sys.actionType));
  add('Attack', describeAttack(sys.attack, str(sys.ability), scalar(sys.attackBonus)));
  add('Damage', describeDamage(sys.damage));
  const damage = rec(sys.damage);
  add('Versatile', str(damage?.versatile) ?? describeDamagePart(damage?.versatile));
  add('Other formula', str(sys.formula));
  add('Save', describeSave(sys.save));
  const consume = rec(sys.consume);
  if (str(consume?.type)) {
    add('Consumes', joinParts(scalar(consume?.amount), str(consume?.type), str(consume?.target)));
  }
  add(
    'Properties',
    item.type === 'spell' ? undefined : strings(sys.properties).join(', ') || undefined,
  );

  const activities = describeActivities(sys);
  if (activities.length > 0) {
    lines.push('**Activities:**', ...activities);
  }

  add('Source', describeSource(sys.source));

  const description = htmlToText(rec(sys.description)?.value ?? sys.description);
  if (description) {
    lines.push('', '**Description:**', description);
  } else {
    lines.push('**Description:** not stored');
  }

  return lines.join('\n');
}
