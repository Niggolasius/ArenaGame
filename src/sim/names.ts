// Alle Namen, die Spieler sehen. Das Spiel ist auf Englisch.

import type { ResourceId } from './config';
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
  if (silver < 0) return `−${formatMoney(-silver)}`;
  const g = Math.floor(silver / 100);
  const s = silver % 100;
  if (g && s) return `${g.toLocaleString('en-US')} Gold ${s} Silver`;
  return g ? `${g.toLocaleString('en-US')} Gold` : `${s} Silver`;
}

// ---------- Meilenstein 3: Insel, Inventar, Postfach ----------


export const RESOURCE_NAMES: Record<ResourceId, string> = {
  copper: 'Copper Ore',
  iron: 'Iron Ore',
  coal: 'Coal',
  obsidian: 'Obsidian',
  crystalShard: 'Crystal Shard',
  starsteel: 'Starsteel',
};

/** Grundsteine heißen nach dem Stat, Sondersteine nach ihrer Mechanik. */
export const BASE_STONE_NAMES: Record<StatKey, string> = {
  atk: 'Ruby of Might',
  def: 'Sapphire of Hardness',
  hp: 'Garnet of Vigor',
  spd: 'Emerald of Haste',
};
export const SPECIAL_STONE_NAMES: Record<Exclude<StoneKind['type'], 'base'>, string> = {
  crit: 'Hawkeye Stone',
  bloodthirst: 'Bloodthirst Stone',
  wrath: 'Stone of Wrath',
  thorns: 'Thorn Stone',
  firstStrike: 'First Strike Stone',
  curse: 'Curse Stone',
};
export const SPECIAL_STONE_HINTS: Record<Exclude<StoneKind['type'], 'base'>, string> = {
  crit: 'More critical hits',
  bloodthirst: 'Heals on hit',
  wrath: 'More damage at low HP',
  thorns: 'Reflects damage',
  firstStrike: 'First hit cannot be dodged',
  curse: 'Weakens the enemy',
};

export const MAIL_TABS = { fight: 'Fights', mine: 'Mine', system: 'System' } as const;

export const UI3 = {
  island: 'Island',
  inventory: 'Inventory',
  mailbox: 'Mailbox',
  collect: 'Collect',
  storageFull: 'STORAGE FULL',
  wornOut: 'WORN OUT',
  run: 'Run',
  runsLeft: 'runs left',
  storage: 'Storage',
  emptyPlot: 'Empty plot',
  place: 'Place card',
  kitchenSoon: 'Kitchen · coming in Milestone 4',
  showResult: 'Show result',
  watchReplay: 'Watch replay',
  claimAll: 'Claim all',
  claimed: 'Claimed',
  neverExpires: 'Never expires',
  bonusLoot: 'Bonus Loot',
  revealHint: 'Revealed one by one, the rarest last',
  victory: 'VICTORY',
  defeat: 'DEFEAT',
  mineHaul: 'Mine haul',
};
