// Alle Zahlen des Spiels an einer Stelle. Das Test-Tool kann jede davon ändern,
// ohne dass Code angefasst werden muss. Beträge in Silber (1 Gold = 100 Silber).

import type { Rarity, Stance, Style } from './types';

export interface StanceMod {
  dmg: number; // Faktor auf ausgeteilten Schaden
  taken: number; // Faktor auf erlittenen Schaden
  dodge: number; // zusätzliche Ausweichchance
}

export interface Config {
  sim: {
    ticksPerSecond: number;
    maxSeconds: number;
    hpPerPoint: number; // max HP = hpPerPoint * HP
    dmgPerAtk: number; // Schaden pro Treffer = dmgPerAtk * ATK (vor Faktoren)
    attacksPerSecond: number; // Grundtempo, SPD erhöht es
    dmgSpread: number; // Streuung pro Treffer, +- Anteil
    critChance: number;
    critMult: number;
    critCap: number;
    dodgeChance: number;
    dodgeCap: number;
    startDelayMax: number; // zufälliger Start-Versatz in Sekunden
    formSpread: number; // Tagesform: Schaden pro Kampf zufällig um +- diesen Anteil
    luckyChance: number; // Wuchttreffer: Chance pro Treffer
    luckyHpFrac: number; // Wuchttreffer: Zusatzschaden als Anteil der gegnerischen max HP
  };
  styles: Record<Style, { dmg: number; rate: number; prefers: 'near' | 'far' }>;
  distanceBonus: number; // Schadensbonus, wenn die Distanz zum Stil passt
  stances: Record<Stance, StanceMod>;
  counterDmg: number; // Schadensfaktor, wenn die eigene Haltung die gegnerische schlägt
  lastStand: {
    threshold: number;
    allIn: { dmg: number; taken: number };
    holdOut: { dmg: number; taken: number };
  };
  stones: {
    baseValue: Record<Rarity, number>;
    crit: Partial<Record<Rarity, number>>; // zusätzliche Krit-Chance
    bloodthirst: Partial<Record<Rarity, number>>; // Anteil des Schadens als Heilung
    wrathMax: number; // Schadensbonus bei 0 % HP, linear
    thorns: number; // Anteil des erlittenen Schadens, der zurückgeht
    curse: number; // Schadensfaktor für den Gegner
    firstStrikeHpFrac: number; // erster Treffer: Zusatzschaden als Anteil der gegnerischen max HP, nicht ausweichbar
  };
  /** Kraft-Aufschlag für Sondersteine bei der Berechnung von K (Klassen, Anzeige). */
  kSurcharge: Partial<Record<Rarity, number>>;
  maxSpecialStones: number;
  stoneTolerance: number; // erlaubte Abweichung des gemessenen K-Faktors vom eingestellten Aufschlag
  statMin: number;
  statCap: number;
  formulaExponent: number;
  rarityRanges: Record<Exclude<Rarity, 'mythic'>, [number, number]>;
  arena: {
    classes: { id: string; name: string; minK: number; maxK: number; stake: number; stoneRarity: Rarity }[];
    arenaShare: number;
  };
}

export const DEFAULT_CONFIG: Config = {
  sim: {
    ticksPerSecond: 20,
    maxSeconds: 90,
    hpPerPoint: 300,
    dmgPerAtk: 50,
    attacksPerSecond: 0.35,
    dmgSpread: 0.4,
    critChance: 0.15,
    critMult: 2,
    critCap: 0.6,
    dodgeChance: 0.05,
    dodgeCap: 0.4,
    startDelayMax: 1.5,
    formSpread: 0.65,
    luckyChance: 0.15,
    luckyHpFrac: 0.3,
  },
  styles: {
    heavy: { dmg: 1.33, rate: 1 / 1.35, prefers: 'near' },
    swift: { dmg: 0.75, rate: 1 / 0.75, prefers: 'near' },
    spear: { dmg: 1, rate: 1, prefers: 'far' },
  },
  distanceBonus: 0.03,
  stances: {
    aggressive: { dmg: 1.12, taken: 1.12, dodge: 0 },
    evasive: { dmg: 0.86, taken: 1, dodge: 0.1 },
    defensive: { dmg: 0.88, taken: 0.88, dodge: 0 },
  },
  counterDmg: 1.13,
  lastStand: {
    threshold: 0.25,
    allIn: { dmg: 1.3, taken: 1.3 },
    holdOut: { dmg: 0.75, taken: 0.75 },
  },
  stones: {
    baseValue: { common: 1, rare: 2, epic: 3, legendary: 4, mythic: 4 },
    crit: { epic: 0.2, legendary: 0.29, mythic: 0.34 },
    bloodthirst: { epic: 0.15, legendary: 0.24, mythic: 0.27 },
    wrathMax: 0.6,
    thorns: 0.22,
    curse: 0.76,
    firstStrikeHpFrac: 0.14,
  },
  kSurcharge: { epic: 1.08, legendary: 1.12, mythic: 1.14 },
  maxSpecialStones: 1,
  stoneTolerance: 0.02,
  statMin: 1,
  statCap: 13,
  formulaExponent: 4,
  rarityRanges: { common: [1, 5], rare: [3, 7], epic: [5, 9], legendary: [7, 10] },
  arena: {
    classes: [
      { id: 'bronze', name: 'Bronze', minK: 0, maxK: 8, stake: 50, stoneRarity: 'common' },
      { id: 'silver', name: 'Silver', minK: 8, maxK: 12, stake: 300, stoneRarity: 'rare' },
      { id: 'gold', name: 'Gold', minK: 12, maxK: 16, stake: 2000, stoneRarity: 'epic' },
      { id: 'champion', name: 'Champion', minK: 16, maxK: 999, stake: 10000, stoneRarity: 'legendary' },
    ],
    arenaShare: 0.1,
  },
};

export function cloneConfig(c: Config): Config {
  return JSON.parse(JSON.stringify(c));
}
