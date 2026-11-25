// Kleine Pixel-Icons für Inventar und Postfach (16×16, Platzhalter wie alle Grafik).
// Jedes Icon wird einmal gezeichnet und als Bild-URL zwischengespeichert.

import type { ResourceId } from '../sim/config';
import type { LootEntry } from '../sim/loot';
import type { Rarity, Slot, StatKey, Stone } from '../sim/types';

export const RARITY_COLORS: Record<Rarity, string> = {
  common: '#5fbf6a',
  rare: '#4f8fe8',
  epic: '#b05ee8',
  legendary: '#f08a24',
  mythic: '#ffffff',
};

const STAT_GEM: Record<StatKey, [string, string, string]> = {
  atk: ['#c0303a', '#ff6a6a', '#6e1219'],
  def: ['#2f5fc8', '#7fb0ff', '#17306e'],
  hp: ['#2f9a4a', '#7ee08c', '#165028'],
  spd: ['#d0a020', '#ffe27a', '#6e5210'],
};
const SPECIAL_GEM: Record<string, [string, string, string]> = {
  crit: ['#e0c040', '#fff4a0', '#7a6410'],
  bloodthirst: ['#a01020', '#ff4060', '#500810'],
  wrath: ['#e04010', '#ffa060', '#701808'],
  thorns: ['#3a8a30', '#a0e070', '#1a4a14'],
  firstStrike: ['#e8e8f0', '#ffffff', '#707088'],
  curse: ['#5a2a8a', '#c080ff', '#2a1048'],
};
const RES_COL: Record<ResourceId, [string, string]> = {
  copper: ['#c8742a', '#f0a95a'],
  iron: ['#8d98a6', '#e1e7ee'],
  coal: ['#2a2a2e', '#5a5a66'],
  obsidian: ['#3a1a5a', '#b07ae0'],
  crystalShard: ['#3fb6d8', '#c8f4ff'],
  starsteel: ['#c8d8ff', '#ffffff'],
};

const cache = new Map<string, string>();
const S = 16;

function make(key: string, draw: (px: (x: number, y: number, w: number, h: number, c: string) => void) => void): string {
  let url = cache.get(key);
  if (url) return url;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const c = cv.getContext('2d')!;
  draw((x, y, w, h, col) => {
    c.fillStyle = col;
    c.fillRect(x, y, w, h);
  });
  url = cv.toDataURL();
  cache.set(key, url);
  return url;
}

export function stoneIcon(s: Stone): string {
  const [m, hi, dk] = s.kind.type === 'base' ? STAT_GEM[s.kind.stat] : SPECIAL_GEM[s.kind.type];
  const key = `stone:${s.kind.type === 'base' ? s.kind.stat : s.kind.type}`;
  return make(key, (px) => {
    // geschliffener Edelstein
    px(5, 3, 6, 1, dk);
    px(4, 4, 8, 1, hi);
    px(3, 5, 10, 3, m);
    px(4, 5, 3, 1, hi);
    px(4, 8, 8, 2, m);
    px(5, 10, 6, 1, dk);
    px(6, 11, 4, 1, dk);
    px(7, 12, 2, 1, dk);
    px(10, 6, 2, 3, dk);
    px(5, 6, 1, 1, '#ffffff');
  });
}

export function resIcon(r: ResourceId): string {
  const [m, hi] = RES_COL[r];
  return make(`res:${r}`, (px) => {
    if (r === 'crystalShard') {
      px(7, 2, 2, 2, hi);
      px(6, 4, 4, 6, m);
      px(7, 4, 1, 5, hi);
      px(5, 10, 6, 2, m);
      px(3, 8, 2, 4, m);
      px(11, 7, 2, 5, m);
      return;
    }
    if (r === 'starsteel') {
      px(3, 6, 10, 5, '#8090b0');
      px(3, 6, 10, 1, hi);
      px(4, 7, 8, 3, m);
      px(7, 3, 1, 2, '#ffffff');
      px(6, 4, 3, 1, '#ffffff');
      return;
    }
    // Erzbrocken
    px(4, 5, 8, 7, '#5b5149');
    px(5, 4, 6, 1, '#7a6e64');
    px(3, 7, 1, 4, '#3e3631');
    px(12, 6, 1, 5, '#3e3631');
    px(4, 12, 8, 1, '#3e3631');
    px(5, 6, 2, 2, m);
    px(5, 6, 1, 1, hi);
    px(9, 8, 2, 2, m);
    px(9, 8, 1, 1, hi);
    px(6, 10, 2, 1, m);
  });
}

export function itemIcon(slot: Slot, rarity: Rarity): string {
  const accent = RARITY_COLORS[rarity] === '#ffffff' ? '#c03030' : RARITY_COLORS[rarity];
  return make(`item:${slot}:${rarity}`, (px) => {
    if (slot === 'weapon') {
      for (let i = 0; i < 8; i++) px(4 + i, 11 - i, 2, 1, i > 5 ? '#ffffff' : '#c8d0d8');
      px(3, 10, 4, 1, accent);
      px(4, 9, 1, 3, accent);
      px(2, 12, 2, 2, '#7a4a2a');
    } else if (slot === 'armor') {
      px(3, 3, 3, 2, accent);
      px(10, 3, 3, 2, accent);
      px(4, 4, 8, 9, '#8d98a6');
      px(5, 5, 6, 1, '#e1e7ee');
      px(7, 6, 2, 6, accent);
      px(4, 12, 8, 1, '#5d646d');
    } else {
      px(4, 2, 1, 5, '#e2b44d');
      px(11, 2, 1, 5, '#e2b44d');
      px(5, 7, 1, 2, '#e2b44d');
      px(10, 7, 1, 2, '#e2b44d');
      px(6, 9, 4, 4, accent);
      px(7, 10, 1, 1, '#ffffff');
    }
  });
}

export function cardIcon(rarity: Rarity): string {
  const col = RARITY_COLORS[rarity];
  return make(`card:${rarity}`, (px) => {
    px(3, 1, 10, 14, col === '#ffffff' ? '#c03030' : col);
    px(4, 2, 8, 12, '#2a211b');
    px(5, 3, 6, 6, '#3d3026');
    px(6, 6, 4, 3, '#5b5149');
    px(7, 4, 1, 3, '#a8743f'); // Hacke
    px(6, 4, 3, 1, '#c8d0d8');
    px(5, 10, 6, 1, col === '#ffffff' ? '#c03030' : col);
    px(5, 12, 4, 1, '#a8977f');
  });
}

export function entryIcon(e: LootEntry): string {
  switch (e.kind) {
    case 'res':
      return resIcon(e.res);
    case 'stone':
      return stoneIcon(e.stone);
    case 'item':
      return itemIcon(e.item.slot, e.item.rarity);
    case 'card':
      return cardIcon(e.card.rarity);
  }
}
