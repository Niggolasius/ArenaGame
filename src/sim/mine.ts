// Minen ohne Grafik: Durchgänge, Lager, Verschleiß. Rein rechnerisch, damit es sich testen lässt.
//
// Regeln (Plan): Eine Karte läuft, bis sie verbraucht ist. Jeder fertige Durchgang landet im Lager.
// Passt nichts mehr ins Lager, steht die Mine still, ohne Verschleiß. Abholen leert das Lager.

import type { Config, MineCardDef, MineRarity, ResourceId } from './config';
import { uid } from './factory';
import { mergeLoot, rollStone, type LootEntry, type MineCard } from './loot';
import { deriveSeed, mulberry32 } from './rng';
import type { Rarity } from './types';

export interface Plot {
  card: MineCard | null;
  progress: number; // Sekunden im laufenden Durchgang
  storage: LootEntry[][]; // ein Eintrag pro fertigem Durchgang
  runNo: number; // Nummer des nächsten Durchgangs dieser Karte
}

export type MineStatus = 'empty' | 'running' | 'full' | 'worn';

export function makeMineCard(rarity: MineRarity, cfg: Config, seed = (Math.random() * 2 ** 32) >>> 0): MineCard {
  const runs = cfg.mine.cards[rarity].runs;
  return { id: uid('c'), rarity, seed, runsLeft: runs, runsTotal: runs };
}

export function emptyPlot(): Plot {
  return { card: null, progress: 0, storage: [], runNo: 0 };
}

export function placeCard(plot: Plot, card: MineCard): void {
  plot.card = card;
  plot.progress = 0;
  plot.runNo = card.runsTotal - card.runsLeft;
}

export function mineStatus(plot: Plot, cfg: Config): MineStatus {
  if (!plot.card) return 'empty';
  if (plot.card.runsLeft <= 0) return 'worn';
  if (plot.storage.length >= cfg.mine.storageRuns) return 'full';
  return 'running';
}

/** Was ein Durchgang bringt. Hängt nur von Karte (Seed) und Nummer des Durchgangs ab. */
export function mineRunDrops(card: MineCard, runNo: number, cfg: Config): LootEntry[] {
  const def = cfg.mine.cards[card.rarity];
  const rng = mulberry32(deriveSeed(card.seed, runNo));
  const out: LootEntry[] = [];
  for (const row of def.drops) {
    // Immer beide Zahlen ziehen, damit eine geänderte Chance die übrigen Zeilen nicht verschiebt.
    const hit = rng() < row.chance;
    const base = row.min + Math.floor(rng() * (row.max - row.min + 1));
    if (!hit) continue;
    if (row.res === 'gem') {
      for (let i = 0; i < base; i++) out.push({ kind: 'stone', stone: rollStone(rng, row.gemRarity ?? 'common', cfg) });
    } else {
      out.push({ kind: 'res', res: row.res, n: Math.max(1, Math.round(base * def.yieldMult)) });
    }
  }
  return out;
}

/**
 * Lässt die Zeit `dt` (Sekunden) laufen. Gibt die fertigen Durchgänge zurück (für Anzeige und „Letzte Drops“).
 * Volles Lager oder verbrauchte Karte: Stillstand, der Balken bleibt stehen.
 */
export function tickPlot(plot: Plot, dt: number, cfg: Config): LootEntry[][] {
  const done: LootEntry[][] = [];
  const cycle = Math.max(0.05, cfg.mine.cycleSeconds);
  while (dt > 0 && plot.card && mineStatus(plot, cfg) === 'running') {
    const need = cycle - plot.progress;
    if (dt < need) {
      plot.progress += dt;
      break;
    }
    dt -= need;
    plot.progress = 0;
    const drops = mineRunDrops(plot.card, plot.runNo, cfg);
    plot.storage.push(drops);
    plot.runNo++;
    plot.card.runsLeft--;
    done.push(drops);
  }
  return done;
}

/** Lager leeren. Die Mine läuft danach sofort weiter. */
export function collectPlot(plot: Plot): { runs: number; loot: LootEntry[] } {
  const runs = plot.storage.length;
  const loot = mergeLoot(plot.storage.flat());
  plot.storage = [];
  return { runs, loot };
}

/** Erwartete Menge pro Durchgang, ausgerechnet aus der Tabelle (für das Test-Tool). */
export function expectedPerRun(def: MineCardDef): { res: Partial<Record<ResourceId, number>>; gems: Partial<Record<Rarity, number>> } {
  const res: Partial<Record<ResourceId, number>> = {};
  const gems: Partial<Record<Rarity, number>> = {};
  for (const row of def.drops) {
    let avg = 0;
    const span = row.max - row.min + 1;
    for (let n = row.min; n <= row.max; n++) avg += row.res === 'gem' ? n : Math.max(1, Math.round(n * def.yieldMult));
    avg = (avg / span) * row.chance;
    if (row.res === 'gem') {
      const r = row.gemRarity ?? 'common';
      gems[r] = (gems[r] ?? 0) + avg;
    } else res[row.res] = (res[row.res] ?? 0) + avg;
  }
  return { res, gems };
}
