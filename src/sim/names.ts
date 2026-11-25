// Alle Namen, die Spieler sehen. Das Spiel ist auf Englisch.

import type { Distance, LastStand, Rarity, Slot, Stance, StatKey, StoneKind, Style } from './types';

export const RARITY_NAMES: Record<Rarity, string> = {
  common: 'Common',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
  mythic: 'Mythic',
};
export const STAT_NAMES: Record<StatKey, string> = { atk: 'ATK', def: 'DEF', hp: 'HP', spd: 'SPD' };
export const STYLE_NAMES: Record<Style, string> = { heavy: 'Heavy', swift: 'Swift', spear: 'Spear' };
export const STANCE_NAMES: Record<Stance, string> = { aggressive: 'Aggressive', evasive: 'Evasive', defensive: 'Defensive' };
export const DISTANCE_NAMES: Record<Distance, string> = { near: 'Close', far: 'Range' };
export const LAST_STAND_NAMES: Record<LastStand, string> = { normal: 'Normal', allIn: 'All In', holdOut: 'Hold Out' };
export const SLOT_NAMES: Record<Slot, string> = { weapon: 'Weapon', armor: 'Armor', amulet: 'Amulet' };
export const STONE_NAMES: Record<StoneKind['type'], string> = {
  base: 'Base Stone',
  crit: 'Crit',
  bloodthirst: 'Bloodthirst',
  wrath: 'Wrath',
  thorns: 'Thorns',
  firstStrike: 'First Strike',
  curse: 'Curse',
};

/** Tagesform-Einblendung beim Kampfstart. Grenzen in Prozent Schaden. */
export const FORM_TIERS: { min: number; label: string }[] = [
  { min: 0.4, label: 'In Top Form!' },
  { min: 0.15, label: 'In Good Form' },
  { min: -0.15, label: 'Steady' },
  { min: -0.4, label: 'Off Day' },
  { min: -Infinity, label: 'Terrible Day' },
];
export function formLabel(form: number): string {
  return FORM_TIERS.find((f) => form - 1 >= f.min)!.label;
}

export type MercyChoice = 'gold' | 'honor' | 'kill';
export const MERCY_NAMES: Record<MercyChoice, string> = {
  gold: 'Take the Gold',
  honor: 'Spare with Honor',
  kill: 'Kill',
};
export const MERCY_HINTS: Record<MercyChoice, string> = {
  gold: 'Pocket the bribe and let them live.',
  honor: 'No gold. Help them up. Earn Honor.',
  kill: 'Full loot. The crowd remembers. Butcher.',
};
export const UI = {
  fight: 'FIGHT!',
  victory: 'VICTORY',
  mercy: 'MERCY?',
  crowdDecides: 'The crowd decides',
  rabbleDecides: 'No spectators · the rabble decides',
  decideEarly: 'Decide now and only the votes so far count for Fame',
  spare: 'Spare',
  killVote: 'Kill',
  crit: 'CRIT',
  crushingBlow: 'CRUSHING BLOW',
  dodge: 'Dodge',
  lastStand: 'LAST STAND',
  executed: 'EXECUTED',
  spared: 'SPARED',
  honor: 'HONOR',
  fame: 'Fame',
  honorPts: 'Honor',
  butcherPts: 'Butcher',
  scar: 'Scar',
  fullLoot: 'Full Loot',
  timeUp: 'TIME!',
  offers: 'offers',
  forLife: 'for their life',
  replay: 'Replay',
  yourCall: 'Your call',
};

/** Beträge kommen intern in Silber (100 Silber = 1 Gold). */
export function formatMoney(silver: number): string {
  const g = Math.floor(silver / 100);
  const s = silver % 100;
  if (g && s) return `${g.toLocaleString('en-US')} Gold ${s} Silver`;
  return g ? `${g.toLocaleString('en-US')} Gold` : `${s} Silver`;
}
