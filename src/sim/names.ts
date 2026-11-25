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
