// Loot ohne Grafik: Rohstoffe, Steine, Items und Karten als Einträge, die ins Postfach und ins Inventar wandern.
// Alles mit Seed, damit ein Kampf oder Minen-Durchgang immer denselben Loot ergibt.

import type { Config, MineRarity, ResourceId } from './config';
import { uid } from './factory';
import {
  BASE_STONE_NAMES,
  RARITY_NAMES,
  RESOURCE_NAMES,
  SLOT_NAMES,
  SPECIAL_STONE_HINTS,
  SPECIAL_STONE_NAMES,
  STAT_NAMES,
} from './names';
import type { Rng } from './rng';
import type { Gladiator, Item, Rarity, StatKey, Stone, StoneKind } from './types';

/** Eine Minen-Karte. Sie läuft, bis `runsLeft` 0 ist. */
export interface MineCard {
  id: string;
  rarity: MineRarity;
  seed: number;
  runsLeft: number;
  runsTotal: number;
}

export type LootEntry =
  | { kind: 'res'; res: ResourceId; n: number }
  | { kind: 'stone'; stone: Stone }
  | { kind: 'item'; item: Item }
  | { kind: 'card'; card: MineCard };

export const RARITY_ORDER: Rarity[] = ['common', 'rare', 'epic', 'legendary', 'mythic'];
export const rarityRank = (r: Rarity) => RARITY_ORDER.indexOf(r);

export const RES_RARITY: Record<ResourceId, Rarity> = {
  copper: 'common',
  iron: 'common',
  coal: 'common',
  crystalShard: 'rare',
  obsidian: 'epic',
  starsteel: 'legendary',
};
export const RESOURCE_IDS = Object.keys(RES_RARITY) as ResourceId[];

export function entryRarity(e: LootEntry): Rarity {
  switch (e.kind) {
    case 'res':
      return RES_RARITY[e.res];
    case 'stone':
      return e.stone.rarity;
    case 'item':
      return e.item.rarity;
    case 'card':
      return e.card.rarity;
  }
}

/** Reihenfolge beim Aufdecken: das Seltenste zuletzt. Bei gleicher Seltenheit bleibt die Reihenfolge. */
export function sortForReveal(list: LootEntry[]): LootEntry[] {
  return list
    .map((e, i) => ({ e, i }))
    .sort((x, y) => rarityRank(entryRarity(x.e)) - rarityRank(entryRarity(y.e)) || x.i - y.i)
    .map((x) => x.e);
}

/** Rohstoffe gleicher Sorte zusammenlegen, alles andere bleibt einzeln. */
export function mergeLoot(list: LootEntry[]): LootEntry[] {
  const out: LootEntry[] = [];
  const stacks = new Map<ResourceId, { kind: 'res'; res: ResourceId; n: number }>();
  for (const e of list) {
    if (e.kind === 'res') {
      const s = stacks.get(e.res);
      if (s) s.n += e.n;
      else {
        const c = { ...e };
        stacks.set(e.res, c);
        out.push(c);
      }
    } else out.push(e);
  }
  return out;
}

export function pickWeighted<T extends string>(rng: Rng, weights: Partial<Record<T, number>>): T {
  const entries = Object.entries(weights).filter(([, w]) => (w as number) > 0) as [T, number][];
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [k, w] of entries) {
    r -= w;
    if (r < 0) return k;
  }
  return entries[entries.length - 1][0];
}

const STATS: StatKey[] = ['atk', 'def', 'hp', 'spd'];
const SPECIAL_BY_RARITY: Partial<Record<Rarity, StoneKind['type'][]>> = {
  epic: ['crit', 'bloodthirst'],
  legendary: ['crit', 'bloodthirst'],
  mythic: ['wrath', 'thorns', 'firstStrike', 'curse'],
};

/** Ein Stein dieser Seltenheit. Ab Epic mit `specialChance` ein Sonderstein, Mythic immer ein Sonderstein. */
export function rollStone(rng: Rng, rarity: Rarity, cfg: Config): Stone {
  const specials = SPECIAL_BY_RARITY[rarity];
  const special = specials && (rarity === 'mythic' || rng() < cfg.loot.specialChance);
  const pick = rng();
  if (special && specials) {
    const type = specials[Math.floor(pick * specials.length)];
    return { id: uid('s'), rarity, kind: { type } as StoneKind };
  }
  const stat = STATS[Math.floor(pick * STATS.length)];
  return { id: uid('s'), rarity, kind: { type: 'base', stat, value: cfg.stones.baseValue[rarity] } };
}

/** Bonus-Loot für den Sieger: Steine nach Arena-Klasse plus ein paar Rohstoffe. */
export function rollBonusLoot(rng: Rng, classId: string, cfg: Config): LootEntry[] {
  const def = cfg.loot.bonus[classId];
  if (!def) return [];
  const out: LootEntry[] = [];
  const [lo, hi] = def.stones;
  const n = lo + Math.floor(rng() * (hi - lo + 1));
  for (let i = 0; i < n; i++) out.push({ kind: 'stone', stone: rollStone(rng, pickWeighted(rng, def.rarity), cfg) });
  for (const r of def.res) {
    const hit = rng() < r.chance;
    const amount = r.min + Math.floor(rng() * (r.max - r.min + 1));
    if (hit) out.push({ kind: 'res', res: r.res, n: amount });
  }
  return out;
}

/** Ein Item zählt als Beute, wenn es etwas kann (Bonus oder Sockel). Leere Test-Slots nicht. */
export function isRealItem(it: Item): boolean {
  return it.sockets > 0 || Object.values(it.bonus).some((v) => (v ?? 0) !== 0);
}

/** Full Loot: jedes Item des Getöteten wird mit `trashChance` zerstört, samt Steinen. Der Rest geht an den Sieger. */
export function fullLoot(rng: Rng, loser: Gladiator, cfg: Config): { kept: Item[]; trashed: Item[] } {
  const kept: Item[] = [];
  const trashed: Item[] = [];
  for (const it of loser.items) {
    if (!isRealItem(it)) continue;
    if (rng() < cfg.loot.trashChance) trashed.push(it);
    else
      kept.push({
        ...it,
        id: uid('i'),
        name: `${loser.name}'s ${SLOT_NAMES[it.slot]}`,
        stones: it.stones.slice(0, it.sockets).map((s) => ({ ...s, id: uid('s') })),
      });
  }
  return { kept, trashed };
}

// ---------- Namen für die Anzeige ----------

export function stoneName(s: Stone): string {
  return s.kind.type === 'base' ? BASE_STONE_NAMES[s.kind.stat] : SPECIAL_STONE_NAMES[s.kind.type];
}
export function stoneDetail(s: Stone, cfg: Config): string {
  if (s.kind.type === 'base') return `+${cfg.stones.baseValue[s.rarity]} ${STAT_NAMES[s.kind.stat]}`;
  return SPECIAL_STONE_HINTS[s.kind.type];
}
export function itemDetail(it: Item): string {
  const b = (Object.entries(it.bonus) as [StatKey, number][]).filter(([, v]) => v).map(([k, v]) => `${STAT_NAMES[k]} +${v}`);
  const sock = it.sockets ? `${it.sockets} socket${it.sockets > 1 ? 's' : ''}` : '';
  return [SLOT_NAMES[it.slot], ...b, sock].filter(Boolean).join(' · ');
}

export function entryName(e: LootEntry, cfg: Config): string {
  switch (e.kind) {
    case 'res':
      return e.n > 1 ? `${e.n} × ${RESOURCE_NAMES[e.res]}` : RESOURCE_NAMES[e.res];
    case 'stone':
      return stoneName(e.stone);
    case 'item':
      return e.item.name;
    case 'card':
      return cfg.mine.cards[e.card.rarity].name;
  }
}
export function entryDetail(e: LootEntry, cfg: Config): string {
  const r = RARITY_NAMES[entryRarity(e)];
  switch (e.kind) {
    case 'res':
      return `${r} material`;
    case 'stone':
      return `${r} · ${stoneDetail(e.stone, cfg)}`;
    case 'item':
      return `${r} · ${itemDetail(e.item)}`;
    case 'card':
      return `${r} mine card · ${e.card.runsLeft} runs`;
  }
}
