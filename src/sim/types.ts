// Grundtypen der Kampf-Simulation. Keine Grafik, kein DOM.

export type StatKey = 'atk' | 'def' | 'hp' | 'spd';
export type Stats = Record<StatKey, number>;

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic';
export type Style = 'heavy' | 'swift' | 'spear';
export type Stance = 'aggressive' | 'evasive' | 'defensive';
export type Distance = 'near' | 'far';
export type LastStand = 'normal' | 'allIn' | 'holdOut';

/** Grundsteine erhöhen einen Stat, Sondersteine haben eine Mechanik. */
export type StoneKind =
  | { type: 'base'; stat: StatKey; value: number }
  | { type: 'crit' }
  | { type: 'bloodthirst' }
  | { type: 'wrath' }
  | { type: 'thorns' }
  | { type: 'firstStrike' }
  | { type: 'curse' };

export interface Stone {
  id: string;
  rarity: Rarity;
  kind: StoneKind;
}

export type Slot = 'weapon' | 'armor' | 'amulet';

export interface Item {
  id: string;
  slot: Slot;
  rarity: Rarity;
  name: string;
  bonus: Partial<Stats>;
  sockets: number; // 0 bis 2
  stones: Stone[];
}

export interface Orders {
  stance: Stance;
  distance: Distance;
  lastStand: LastStand;
}

export interface Gladiator {
  id: string;
  name: string;
  rarity: Rarity;
  style: Style;
  base: Stats;
  items: Item[];
  orders: Orders;
}

/** Ein Ereignis im Kampf. Die Darstellung (Meilenstein 2) spielt diese Liste ab. */
export type FightEvent =
  | { t: number; type: 'hit'; from: 0 | 1; dmg: number; crit: boolean; lucky: boolean; hpLeft: number }
  | { t: number; type: 'dodge'; from: 0 | 1 }
  | { t: number; type: 'heal'; who: 0 | 1; amount: number; hpLeft: number }
  | { t: number; type: 'thorns'; who: 0 | 1; dmg: number; hpLeft: number }
  | { t: number; type: 'laststand'; who: 0 | 1 }
  | { t: number; type: 'end'; winner: 0 | 1; reason: 'ko' | 'time' };

export interface FightResult {
  winner: 0 | 1;
  ticks: number;
  seconds: number;
  hpLeft: [number, number];
  maxHp: [number, number];
  hits: [number, number];
  form: [number, number]; // Tagesform als Schadensfaktor, z. B. 1.2 = +20 %
  events?: FightEvent[];
}
