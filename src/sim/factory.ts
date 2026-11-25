// Gladiatoren, Items und Steine erzeugen: für das Test-Tool, die Analysen und später das Spiel.

import type { Config } from './config';
import { SLOT_NAMES } from './names';
import type { Rng } from './rng';
import type { Gladiator, Item, Orders, Rarity, Slot, Stats, Stone, StoneKind, Style } from './types';

let counter = 0;
export const uid = (p: string) => `${p}${(++counter).toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

export const DEFAULT_ORDERS: Orders = { stance: 'aggressive', distance: 'near', lastStand: 'normal' };

export function makeGladiator(p: {
  name?: string;
  rarity?: Rarity;
  style?: Style;
  base: Stats;
  items?: Item[];
  orders?: Partial<Orders>;
}): Gladiator {
  const style = p.style ?? 'spear';
  return {
    id: uid('g'),
    name: p.name ?? 'Gladiator',
    rarity: p.rarity ?? 'common',
    style,
    base: { ...p.base },
    items: p.items ?? [],
    orders: { ...DEFAULT_ORDERS, distance: style === 'spear' ? 'far' : 'near', ...p.orders },
  };
}

export function even(v: number): Stats {
  return { atk: v, def: v, hp: v, spd: v };
}

export function makeStone(rarity: Rarity, kind: StoneKind): Stone {
  return { id: uid('s'), rarity, kind };
}

export function makeItem(slot: Slot, rarity: Rarity, bonus: Partial<Stats>, sockets = 0, stones: Stone[] = []): Item {
  return { id: uid('i'), slot, rarity, name: SLOT_NAMES[slot], bonus, sockets, stones };
}

/** Ein Amulett mit einem Sockel und genau diesem Stein, ohne Stat-Bonus. Für Stein-Tests. */
export function withStone(g: Gladiator, stone: Stone): Gladiator {
  return { ...g, id: uid('g'), items: [...g.items, makeItem('amulet', stone.rarity, {}, 1, [stone])] };
}

export function randomGladiator(rng: Rng, cfg: Config, rarity: Exclude<Rarity, 'mythic'>, style?: Style): Gladiator {
  const [lo, hi] = cfg.rarityRanges[rarity];
  const r = () => lo + Math.floor(rng() * (hi - lo + 1));
  const styles: Style[] = ['heavy', 'swift', 'spear'];
  return makeGladiator({
    rarity,
    style: style ?? styles[Math.floor(rng() * 3)],
    base: { atk: r(), def: r(), hp: r(), spd: r() },
  });
}

/** Stats im Bereich 1..cap frei gewürfelt, für die Formel-Prüfung über die ganze Spanne. */
export function randomStatsGladiator(rng: Rng, cfg: Config, style: Style = 'spear'): Gladiator {
  const r = () => cfg.statMin + Math.floor(rng() * (cfg.statCap - cfg.statMin + 1));
  return makeGladiator({ style, base: { atk: r(), def: r(), hp: r(), spd: r() } });
}
