// Effektive Stats, Kampfkraft K, Arena-Klasse und Formel-Siegchance.

import type { Config } from './config';
import type { Gladiator, Rarity, Stats, Stone, StatKey } from './types';

export const STAT_KEYS: StatKey[] = ['atk', 'def', 'hp', 'spd'];

export function allStones(g: Gladiator): Stone[] {
  return g.items.flatMap((it) => it.stones.slice(0, it.sockets));
}

export function specialStones(g: Gladiator, cfg: Config): Stone[] {
  return allStones(g)
    .filter((s) => s.kind.type !== 'base')
    .slice(0, cfg.maxSpecialStones);
}

/** Grundwerte + Ausrüstung + Grundsteine, begrenzt auf statMin..statCap. */
export function effectiveStats(g: Gladiator, cfg: Config): Stats {
  const s: Stats = { ...g.base };
  for (const it of g.items) {
    for (const k of STAT_KEYS) s[k] += it.bonus[k] ?? 0;
  }
  for (const st of allStones(g)) {
    if (st.kind.type === 'base') s[st.kind.stat] += cfg.stones.baseValue[st.rarity];
  }
  for (const k of STAT_KEYS) s[k] = Math.max(cfg.statMin, Math.min(cfg.statCap, s[k]));
  return s;
}

/** K = sqrt((ATK + SPD/2) * (DEF + HP)), ohne Sondersteine. */
export function rawPower(s: Stats): number {
  return Math.sqrt((s.atk + s.spd / 2) * (s.def + s.hp));
}

/** K inklusive Kraft-Aufschlag für Sondersteine. */
export function power(g: Gladiator, cfg: Config): number {
  let k = rawPower(effectiveStats(g, cfg));
  for (const st of specialStones(g, cfg)) k *= cfg.kSurcharge[st.rarity] ?? 1;
  return k;
}

export function arenaClass(k: number, cfg: Config) {
  return cfg.arena.classes.find((c) => k >= c.minK && k < c.maxK) ?? cfg.arena.classes[cfg.arena.classes.length - 1];
}

/** P(A gewinnt) = K_A^e / (K_A^e + K_B^e). */
export function formulaP(kA: number, kB: number, exponent: number): number {
  const a = Math.pow(kA, exponent);
  const b = Math.pow(kB, exponent);
  return a / (a + b);
}

/** Umkehrung: welcher K-Faktor erklärt eine gemessene Siegquote gegen einen Gleichstarken? */
export function kFactorFromP(p: number, exponent: number): number {
  const q = Math.min(0.9999, Math.max(0.0001, p));
  return Math.pow(q / (1 - q), 1 / exponent);
}

export const RARITY_NAMES: Record<Rarity, string> = {
  common: 'Gewöhnlich',
  rare: 'Selten',
  epic: 'Episch',
  legendary: 'Legendär',
  mythic: 'Mythisch',
};
