// Hält den Spielstand (Insel, Inventar, Postfach) im Test-Tool: laden, speichern, Zeit laufen lassen.
// Eine einzige Schleife pro Bildschirm-Frame lässt die Minen laufen, auch wenn ein anderer Tab offen ist.
// Beim Laden wird die Zeit seit dem letzten Speichern nachgeholt (die Minen laufen „offline“ weiter).

import type { Config } from '../sim/config';
import { newGame, tickGame, unreadCount, upgradeGame, type GameState } from '../sim/game';
import { entryRarity, mergeLoot, rarityRank, entryName, type LootEntry } from '../sim/loot';

const KEY_GAME = 'arenagame.game.v1';
const OFFLINE_CAP_S = 3 * 24 * 3600;

type Listener = {
  frame?: (dt: number) => void;
  drops?: (plot: number, drops: LootEntry[]) => void;
  change?: () => void;
};

let game: GameState;
let getCfg: () => Config;
const listeners = new Set<Listener>();
let dirty = false;
let lastSave = 0;

export function gs(): GameState {
  return game;
}

function load(cfg: Config): GameState {
  try {
    const raw = localStorage.getItem(KEY_GAME);
    if (raw) {
      const g = upgradeGame(JSON.parse(raw) as GameState, cfg);
      const away = Math.min(OFFLINE_CAP_S, Math.max(0, (Date.now() - g.savedAt) / 1000));
      if (away > 1) recordDrops(g, tickGame(g, away, cfg), cfg);
      return g;
    }
  } catch {
    /* kaputter Spielstand: neu anfangen */
  }
  return newGame(cfg);
}

export function save() {
  game.savedAt = Date.now();
  try {
    localStorage.setItem(KEY_GAME, JSON.stringify(game));
  } catch {
    /* egal */
  }
  dirty = false;
  lastSave = performance.now();
}

/** Nach jeder Änderung durch einen Klick: speichern und alle Ansichten (Badge, Geld) auffrischen. */
export function changed() {
  save();
  for (const l of listeners) l.change?.();
}

export function on(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function recordDrops(g: GameState, list: { plot: number; drops: LootEntry[] }[], cfg: Config) {
  const now = Date.now();
  for (const { plot, drops } of list) {
    if (!drops.length) continue;
    const merged = mergeLoot(drops);
    const top = merged.reduce((m, e) => (rarityRank(entryRarity(e)) > rarityRank(m) ? entryRarity(e) : m), entryRarity(merged[0]));
    const mine = g.plots[plot]?.card ? cfg.mine.cards[g.plots[plot].card!.rarity].name : 'Mine';
    g.drops.unshift({ at: now, text: `${merged.map((e) => entryName(e, cfg)).join(', ')} · ${mine}`, rarity: top });
  }
  g.drops.length = Math.min(g.drops.length, 14);
}

export function resetGame() {
  game = newGame(getCfg());
  changed();
}

export function initGame(cfgGetter: () => Config) {
  getCfg = cfgGetter;
  game = load(getCfg());
  save();
  let last = performance.now();
  const loop = (now: number) => {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    const cfg = getCfg();
    const done = tickGame(game, dt, cfg);
    if (done.length) {
      recordDrops(game, done, cfg);
      dirty = true;
      for (const d of done) for (const l of listeners) l.drops?.(d.plot, d.drops);
    }
    for (const l of listeners) l.frame?.(dt);
    if (now - lastSave > 2000) {
      // Fortschritt im laufenden Durchgang auch ohne Fund regelmäßig sichern
      dirty = true;
    }
    if (dirty && now - lastSave > 1000) save();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  // Tab im Hintergrund: rAF pausiert, beim Zurückkommen die verpasste Zeit nachholen
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const away = Math.min(OFFLINE_CAP_S, Math.max(0, (Date.now() - game.savedAt) / 1000));
      if (away > 1) {
        recordDrops(game, tickGame(game, away, getCfg()), getCfg());
        changed();
      }
      last = performance.now();
    } else save();
  });
  window.addEventListener('beforeunload', save);
}

export const badgeCount = () => unreadCount(game);

/** „vor 2 min“ auf Englisch */
export function ago(at: number): string {
  const s = Math.max(0, (Date.now() - at) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${Math.floor(s)} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
