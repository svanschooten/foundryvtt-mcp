/**
 * @fileoverview Optional dnd5e derived stats, worked out from stored data.
 *
 * This is the one place the server applies game rules. dnd5e calculates these
 * values in the browser and never stores them, so they are only produced on
 * request (`get_actor_details` with `derived: true`) and always labelled as
 * calculated. Covered: ability modifiers, proficiency bonus, saving throws,
 * skills and passive Perception, with stored flat bonuses and the Jack of All
 * Trades, Remarkable Athlete and Observant flags.
 *
 * Not covered, and reported in `notApplied` instead of guessed: active
 * effects, bonuses written as formulas (`1d4`, `@prof`), and anything that
 * needs a level or CR when neither is stored. Field paths are dnd5e 3.x; keep
 * them in this file so they are easy to revisit after a system upgrade.
 */

import { actorProgression, formatChallengeRating } from './actor-progression.js';
import type { WorldActor, WorldItem } from './types.js';

type Rec = Record<string, unknown>;

const ABILITIES = [
  ['str', 'STR'],
  ['dex', 'DEX'],
  ['con', 'CON'],
  ['int', 'INT'],
  ['wis', 'WIS'],
  ['cha', 'CHA'],
] as const;

/** dnd5e skill keys, their default ability and display name. */
const SKILLS: ReadonlyArray<readonly [string, string, string]> = [
  ['acr', 'dex', 'Acrobatics'],
  ['ani', 'wis', 'Animal Handling'],
  ['arc', 'int', 'Arcana'],
  ['ath', 'str', 'Athletics'],
  ['dec', 'cha', 'Deception'],
  ['his', 'int', 'History'],
  ['ins', 'wis', 'Insight'],
  ['itm', 'cha', 'Intimidation'],
  ['inv', 'int', 'Investigation'],
  ['med', 'wis', 'Medicine'],
  ['nat', 'int', 'Nature'],
  ['prc', 'wis', 'Perception'],
  ['prf', 'cha', 'Performance'],
  ['per', 'cha', 'Persuasion'],
  ['rel', 'int', 'Religion'],
  ['slt', 'dex', 'Sleight of Hand'],
  ['ste', 'dex', 'Stealth'],
  ['sur', 'wis', 'Survival'],
];

/** Remarkable Athlete applies to checks with these abilities. */
const ATHLETIC_ABILITIES = new Set(['str', 'dex', 'con']);

/**
 * Active-effect keys that would change the values worked out here: the stored
 * numbers, and the dnd5e flags read below (an effect can grant those too).
 */
const RELEVANT_EFFECT_KEY =
  /^(system\.(abilities|skills|bonuses\.abilities|attributes\.prof)\b|flags\.dnd5e\.(jackOfAllTrades|remarkableAthlete|observantFeat)$)/;

export interface DerivedAbility {
  key: string;
  label: string;
  score: number;
  mod: number;
  /** Save total; absent when the proficiency bonus is unknown. */
  save?: number;
  saveProficient: boolean;
}

export interface DerivedSkill {
  key: string;
  label: string;
  ability: string;
  total: number;
  /** Stored multiplier: 0 none, 0.5 half, 1 proficient, 2 expertise. */
  proficiency: number;
}

export interface DerivedStats {
  proficiency?: { bonus: number; source: string };
  abilities: DerivedAbility[];
  skills: DerivedSkill[];
  passivePerception?: number;
  /** What could change these numbers but was not applied. */
  notApplied: string[];
}

function rec(value: unknown): Rec {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Rec) : {};
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Collects stored bonuses: plain integers ("2", "+1", "-1") are added; any
 * other text is a formula and is listed as not applied.
 */
class Bonuses {
  readonly formulas = new Set<string>();

  flat(value: unknown, where: string): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value !== 'string' || value.trim() === '') {
      return 0;
    }
    const text = value.replace(/\s+/g, '');
    if (/^[+-]?\d+$/.test(text)) {
      return Number.parseInt(text, 10);
    }
    this.formulas.add(`${where} "${value.trim()}"`);
    return 0;
  }
}

/**
 * Proficiency bonus: from total class level for characters, from CR for NPCs
 * (CR below 1 counts as 1), as dnd5e does.
 */
function proficiencyOf(actor: WorldActor): DerivedStats['proficiency'] {
  const progression = actorProgression(actor);
  if (actor.type === 'npc' && progression.cr !== undefined) {
    return {
      bonus: Math.floor((Math.max(progression.cr, 1) + 7) / 4),
      source: `CR ${formatChallengeRating(progression.cr)}`,
    };
  }
  if (progression.level !== undefined && progression.level > 0) {
    return {
      bonus: Math.floor((progression.level + 7) / 4),
      source: `level ${progression.level}`,
    };
  }
  return undefined;
}

/** dnd5e suppresses an item's effects while it is unequipped or unattuned. */
function itemEffectsActive(item: WorldItem): boolean {
  const system = rec(item.system);
  if (system.equipped === false) {
    return false;
  }
  // 3.0-3.1 numeric: 1 required, 2 attuned; later: 'required' + `attuned`
  const attunement = system.attunement;
  if (attunement === 2 || system.attuned === true) {
    return true;
  }
  return attunement !== 1 && attunement !== 'required';
}

/** Names of enabled effects that would change abilities, skills or their bonuses. */
function relevantEffects(actor: WorldActor): string[] {
  const effects = [
    ...(actor.effects ?? []),
    ...(actor.items ?? [])
      .filter(itemEffectsActive)
      .flatMap((item) => (item.effects ?? []).filter((e) => rec(e).transfer !== false)),
  ];
  return effects
    .filter((e) => e.disabled !== true)
    .filter((e) => (e.changes ?? []).some((c) => RELEVANT_EFFECT_KEY.test(c.key)))
    .map((e) => e.name);
}

/**
 * Works out a dnd5e actor's ability modifiers, saves, skills and passive
 * Perception from stored data. See the file overview for what is left out.
 */
export function dnd5eDerivedStats(actor: WorldActor): DerivedStats {
  const system = rec(actor.system);
  const stored = rec(system.abilities);
  const global = rec(rec(system.bonuses).abilities);
  const flags = rec(rec(actor.flags).dnd5e);
  const bonuses = new Bonuses();
  const notApplied: string[] = [];

  const proficiency = proficiencyOf(actor);
  const prof = proficiency?.bonus;
  if (prof === undefined) {
    notApplied.push(
      'saves and skills: no proficiency bonus, because neither a level nor a CR is stored',
    );
  }

  const abilities: DerivedAbility[] = [];
  const mods = new Map<string, number>();
  for (const [key, label] of ABILITIES) {
    const entry = rec(stored[key]);
    const score = num(entry.value);
    if (score === undefined) {
      continue;
    }
    const mod = Math.floor((score - 10) / 2);
    mods.set(key, mod);
    const saveProficient = (num(entry.proficient) ?? 0) >= 1;
    const row: DerivedAbility = { key, label, score, mod, saveProficient };
    if (prof !== undefined) {
      row.save =
        mod +
        (saveProficient ? prof : 0) +
        bonuses.flat(rec(entry.bonuses).save, `${label} save bonus`) +
        bonuses.flat(global.save, 'global save bonus');
    }
    abilities.push(row);
  }

  const skills: DerivedSkill[] = [];
  let passivePerception: number | undefined;
  if (prof !== undefined) {
    const storedSkills = rec(system.skills);
    for (const [key, defaultAbility, label] of SKILLS) {
      if (!(key in storedSkills)) {
        continue;
      }
      const entry = rec(storedSkills[key]);
      const abilityKey = typeof entry.ability === 'string' ? entry.ability : defaultAbility;
      const mod = mods.get(abilityKey);
      if (mod === undefined) {
        continue;
      }
      const multiplier = num(entry.value) ?? 0;
      let profPart = Math.floor(multiplier * prof);
      if (multiplier === 0) {
        // Remarkable Athlete rounds half proficiency up; Jack of All Trades down.
        if (flags.remarkableAthlete === true && ATHLETIC_ABILITIES.has(abilityKey)) {
          profPart = Math.ceil(prof / 2);
        } else if (flags.jackOfAllTrades === true) {
          profPart = Math.floor(prof / 2);
        }
      }
      const total =
        mod +
        profPart +
        bonuses.flat(rec(entry.bonuses).check, `${label} check bonus`) +
        bonuses.flat(
          rec(rec(stored[abilityKey]).bonuses).check,
          `${abilityKey.toUpperCase()} check bonus`,
        ) +
        bonuses.flat(global.check, 'global check bonus') +
        bonuses.flat(global.skill, 'global skill bonus');
      skills.push({ key, label, ability: abilityKey, total, proficiency: multiplier });

      if (key === 'prc') {
        passivePerception =
          10 +
          total +
          bonuses.flat(rec(entry.bonuses).passive, 'passive Perception bonus') +
          (flags.observantFeat === true ? 5 : 0);
      }
    }
  }

  if (bonuses.formulas.size > 0) {
    notApplied.push(`bonus formulas: ${[...bonuses.formulas].join(', ')}`);
  }
  const effects = relevantEffects(actor);
  if (effects.length > 0) {
    notApplied.push(`active effects: ${effects.join(', ')}`);
  }

  const result: DerivedStats = { abilities, skills, notApplied };
  if (proficiency) {
    result.proficiency = proficiency;
  }
  if (passivePerception !== undefined) {
    result.passivePerception = passivePerception;
  }
  return result;
}
