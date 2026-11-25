// Spielstand des Prototyps (Meilenstein 3): Geld, Insel mit Minen, Inventar und Postfach.
// Keine Grafik, kein DOM. Das Test-Tool speichert diesen Zustand im Browser.

import { simulate } from './combat';
import type { Config, ResourceId } from './config';
import { fullLoot, mergeLoot, rollBonusLoot, sortForReveal, type LootEntry, type MineCard } from './loot';
import { resolveMercy, setupMercy } from './mercy';
import { collectPlot, emptyPlot, makeMineCard, placeCard, tickPlot, type Plot } from './mine';
import { formatMoney, MERCY_NAMES, SLOT_NAMES, type MercyChoice } from './names';
import { deriveSeed, mulberry32 } from './rng';
import type { Gladiator, Item, Rarity, Stone } from './types';

export type MailKind = 'fight' | 'mine' | 'system';

export interface ResultLine {
  label: string;
  value: string;
  tone?: 'good' | 'bad' | 'gold' | '';
}

export interface FightMail {
  no: number;
  classId: string;
  className: string;
  a: Gladiator; // Schnappschuss, damit das Replay gleich bleibt, auch wenn das Duell geändert wird
  b: Gladiator;
  seed: number;
  choice: MercyChoice;
  choiceAt?: number; // Sekunden nach Beginn der Abstimmung, undefined = nach der Abstimmung
  playerWon: boolean;
  loserDies: boolean;
  lines: ResultLine[];
  gear: LootEntry[]; // Full Loot vom getöteten Gegner (wird mit abgeholt)
  trashed: string[]; // zerstörte Items (Namen)
}

export interface Mail {
  id: number;
  kind: MailKind;
  at: number; // ms seit 1970
  title: string; // verrät nie das Ergebnis
  subtitle: string;
  read: boolean;
  revealed: boolean; // Ergebnis aufgedeckt
  claimed: boolean;
  lootShown?: boolean; // alle Karten schon einmal aufgedeckt
  loot: LootEntry[]; // wird einzeln aufgedeckt, in Aufdeck-Reihenfolge gespeichert
  silver: number; // kommt beim Abholen dazu
  fame: number;
  honor: number;
  butcher: number;
  body?: string;
  fight?: FightMail;
}

export interface Drop {
  at: number;
  text: string;
  rarity: Rarity;
}

export interface GameState {
  v: 1;
  silver: number;
  fame: number;
  honor: number;
  butcher: number;
  plots: Plot[];
  cards: MineCard[]; // Karten im Inventar (nicht platziert)
  items: Item[];
  stones: Stone[];
  res: Partial<Record<ResourceId, number>>;
  mail: Mail[];
  nextMail: number;
  nextFight: number;
  drops: Drop[]; // letzte Minen-Funde für die Anzeige
  timeScale: number; // Zeitraffer für Tests
  savedAt: number;
}

export function newGame(cfg: Config, now = Date.now()): GameState {
  const g: GameState = {
    v: 1,
    silver: 5000,
    fame: 0,
    honor: 0,
    butcher: 0,
    plots: Array.from({ length: cfg.mine.plots }, emptyPlot),
    cards: [],
    items: [],
    stones: [],
    res: {},
    mail: [],
    nextMail: 1,
    nextFight: 1041,
    drops: [],
    timeScale: 1,
    savedAt: now,
  };
  placeCard(g.plots[0], makeMineCard('common', cfg));
  addMail(g, {
    kind: 'system',
    title: 'Welcome to the Arena',
    subtitle: 'A gift to get you started',
    body: 'Your island has a Copper Pit. Here is a second mine card: place it on the free plot.',
    loot: [{ kind: 'card', card: makeMineCard('epic', cfg) }, { kind: 'res', res: 'copper', n: 10 }],
  }, now);
  return g;
}

/** Spielstand aus dem Speicher an neue Felder und Bauplätze anpassen. */
export function upgradeGame(g: GameState, cfg: Config): GameState {
  while (g.plots.length < cfg.mine.plots) g.plots.push(emptyPlot());
  g.drops ??= [];
  g.timeScale ??= 1;
  return g;
}

export function addMail(
  g: GameState,
  m: Partial<Mail> & Pick<Mail, 'kind' | 'title' | 'subtitle'>,
  now = Date.now(),
): Mail {
  const mail: Mail = {
    id: g.nextMail++,
    at: now,
    read: false,
    revealed: m.kind !== 'fight',
    claimed: false,
    loot: [],
    silver: 0,
    fame: 0,
    honor: 0,
    butcher: 0,
    ...m,
  };
  mail.loot = sortForReveal(mail.loot);
  g.mail.unshift(mail);
  return mail;
}

export const hasClaim = (m: Mail) => m.loot.length > 0 || m.silver !== 0 || m.fame !== 0 || m.honor !== 0 || m.butcher !== 0 || (m.fight?.gear.length ?? 0) > 0;

/** Rote Zahl am Postfach: ungelesen oder noch etwas abzuholen. */
export function unreadCount(g: GameState, kind?: MailKind): number {
  return g.mail.filter((m) => (!kind || m.kind === kind) && (!m.read || (!m.claimed && hasClaim(m)))).length;
}

export function addToInventory(g: GameState, loot: LootEntry[]) {
  for (const e of loot) {
    if (e.kind === 'res') g.res[e.res] = (g.res[e.res] ?? 0) + e.n;
    else if (e.kind === 'stone') g.stones.push(e.stone);
    else if (e.kind === 'item') g.items.push(e.item);
    else g.cards.push({ ...e.card });
  }
}

export function claimMail(g: GameState, m: Mail): boolean {
  if (m.claimed) return false;
  addToInventory(g, [...(m.fight?.gear ?? []), ...m.loot]);
  g.silver += m.silver;
  g.fame += m.fame;
  g.honor += m.honor;
  g.butcher += m.butcher;
  m.claimed = true;
  m.read = true;
  m.revealed = true;
  return true;
}

// ---------- Minen ----------

/** Zeit vergehen lassen (Sekunden echter Zeit, mal Zeitraffer). Gibt die neuen Funde zurück. */
export function tickGame(g: GameState, dtReal: number, cfg: Config): { plot: number; drops: LootEntry[] }[] {
  const out: { plot: number; drops: LootEntry[] }[] = [];
  const dt = dtReal * g.timeScale;
  g.plots.forEach((p, i) => {
    for (const drops of tickPlot(p, dt, cfg)) out.push({ plot: i, drops });
  });
  return out;
}

/** Lager einer Mine abholen: der Inhalt kommt als Brief ins Postfach. */
export function collectMine(g: GameState, plotIdx: number, cfg: Config, now = Date.now()): Mail | null {
  const p = g.plots[plotIdx];
  if (!p?.card || p.storage.length === 0) return null;
  const name = cfg.mine.cards[p.card.rarity].name;
  const { runs, loot } = collectPlot(p);
  return addMail(g, { kind: 'mine', title: `${name} · haul`, subtitle: `${runs} run${runs > 1 ? 's' : ''}`, body: `Your worker filled the cart ${runs} time${runs > 1 ? 's' : ''}. The mine keeps digging.`, loot }, now);
}

export function placeFromInventory(g: GameState, plotIdx: number, cardId: string): boolean {
  const p = g.plots[plotIdx];
  const i = g.cards.findIndex((c) => c.id === cardId);
  if (!p || i < 0) return false;
  if (p.storage.length) return false; // erst abholen
  if (p.card) g.cards.push(p.card);
  placeCard(p, g.cards.splice(i, 1)[0]);
  return true;
}

/** Verbrauchte Karte entfernen (sie ist danach weg). Noch volles Lager muss vorher abgeholt sein. */
export function removeWornCard(g: GameState, plotIdx: number): boolean {
  const p = g.plots[plotIdx];
  if (!p?.card || p.card.runsLeft > 0 || p.storage.length) return false;
  g.plots[plotIdx] = emptyPlot();
  return true;
}

/** Karte zurück ins Inventar (nur mit leerem Lager). */
export function unplaceCard(g: GameState, plotIdx: number): boolean {
  const p = g.plots[plotIdx];
  if (!p?.card || p.storage.length) return false;
  if (p.card.runsLeft > 0) g.cards.push(p.card);
  g.plots[plotIdx] = emptyPlot();
  return true;
}

// ---------- Kämpfe ----------

export interface FightReport {
  classId: string;
  className: string;
  stake: number;
  playerWon: boolean;
  winnerName: string;
  loserName: string;
  choice: MercyChoice;
  loserDies: boolean;
  paidNow: number; // Silber, das sofort weg ist (Einsatz, ggf. Lösegeld)
  payout: number; // Silber beim Abholen
  fame: number;
  honor: number;
  butcher: number;
  lines: ResultLine[];
  bonus: LootEntry[];
  gear: LootEntry[];
  trashed: string[];
}

/** Die Entscheidung des Siegers, wenn niemand zusieht: der Mehrheit folgen, bei Gleichstand das Gold. */
export function autoChoice(a: Gladiator, b: Gladiator, seed: number, cfg: Config): MercyChoice {
  const r = simulate(a, b, seed, cfg);
  const setup = setupMercy(a, b, r, seed, cfg);
  const spare = setup.votes.filter((v) => v.spare).length;
  const kill = setup.votes.length - spare;
  return kill > spare ? 'kill' : 'gold';
}

/**
 * Alles, was nach einem Kampf passiert, aus Sicht des Spielers (Seite 0 = A).
 * Deterministisch: gleicher Kampf, gleicher Seed, gleiche Entscheidung, gleicher Loot.
 */
export function fightReport(a: Gladiator, b: Gladiator, seed: number, cfg: Config, choice: MercyChoice, at = Infinity): FightReport {
  const r = simulate(a, b, seed, cfg);
  const setup = setupMercy(a, b, r, seed, cfg);
  const o = resolveMercy(setup, choice, cfg, at);
  const cls = cfg.arena.classes.find((c) => c.id === setup.classId)!;
  const playerWon = r.winner === 0;
  const [winner, loser] = playerWon ? [a, b] : [b, a];
  const rng = mulberry32(deriveSeed(seed, 9101));
  const lines: ResultLine[] = [];
  const stake = cls.stake;
  const pot = Math.round(2 * stake * (1 - cfg.arena.arenaShare));
  let paidNow = stake;
  let payout = 0;
  let bonus: LootEntry[] = [];
  let gear: LootEntry[] = [];
  let trashed: string[] = [];
  const crowd = o.majority === 'tie' ? 'crowd split' : o.followed ? 'you followed the crowd' : 'you defied the crowd';

  if (playerWon) {
    payout += pot;
    lines.push({ label: `Purse · 2 × ${formatMoney(stake)} stake, minus ${Math.round(cfg.arena.arenaShare * 100)} % arena share`, value: `+${formatMoney(pot)}`, tone: 'gold' });
    if (o.gold) {
      payout += o.gold;
      lines.push({ label: `Mercy money from ${loser.name}`, value: `+${formatMoney(o.gold)}`, tone: 'gold' });
    }
    lines.push({ label: `Fame · ${crowd}`, value: `${o.fame >= 0 ? '+' : '−'}${Math.abs(o.fame)}`, tone: o.fame > 0 ? 'good' : o.fame < 0 ? 'bad' : '' });
    if (o.honor) lines.push({ label: 'Honor', value: `+${o.honor}`, tone: 'good' });
    if (o.butcher) lines.push({ label: 'Butcher', value: `+${o.butcher}`, tone: 'bad' });
    lines.push({ label: MERCY_NAMES[choice], value: o.loserDies ? `${loser.name} dies` : `${loser.name} lives · scar −${o.scar}`, tone: o.loserDies ? 'bad' : '' });
    bonus = rollBonusLoot(rng, cls.id, cfg);
    if (o.loserDies) {
      const fl = fullLoot(rng, loser, cfg);
      gear = fl.kept.map((item) => ({ kind: 'item', item }) as LootEntry);
      trashed = fl.trashed.map((it) => `${loser.name}'s ${SLOT_NAMES[it.slot]}`);
    }
  } else {
    lines.push({ label: 'Stake lost', value: `−${formatMoney(stake)}`, tone: 'bad' });
    if (o.gold) {
      paidNow += o.gold;
      lines.push({ label: `You paid ${winner.name} for your life`, value: `−${formatMoney(o.gold)}`, tone: 'bad' });
    }
    lines.push({
      label: `${winner.name} chose: ${MERCY_NAMES[choice]}`,
      value: o.loserDies ? `${loser.name} died · full loot` : `${loser.name} lives · scar −${o.scar}`,
      tone: o.loserDies ? 'bad' : '',
    });
  }
  return {
    classId: cls.id,
    className: cls.name,
    stake,
    playerWon,
    winnerName: winner.name,
    loserName: loser.name,
    choice,
    loserDies: o.loserDies,
    paidNow,
    payout,
    fame: playerWon ? o.fame : 0,
    honor: playerWon ? o.honor : 0,
    butcher: playerWon ? o.butcher : 0,
    lines,
    bonus,
    gear,
    trashed,
  };
}

/** Kampf ins Postfach legen. Der Einsatz ist sofort weg, Gewinn und Loot kommen beim Abholen. */
export function postFight(
  g: GameState,
  a: Gladiator,
  b: Gladiator,
  seed: number,
  cfg: Config,
  choice: MercyChoice,
  at = Infinity,
  opts: { watched?: boolean; now?: number } = {},
): Mail {
  const rep = fightReport(a, b, seed, cfg, choice, at);
  g.silver -= rep.paidNow;
  const no = g.nextFight++;
  const snap = (x: Gladiator) => JSON.parse(JSON.stringify(x)) as Gladiator;
  return addMail(
    g,
    {
      kind: 'fight',
      title: `Fight #${no} finished`,
      subtitle: `${rep.className} Arena · ${a.name} vs ${b.name}`,
      revealed: !!opts.watched,
      loot: rep.bonus,
      silver: rep.payout,
      fame: rep.fame,
      honor: rep.honor,
      butcher: rep.butcher,
      fight: {
        no,
        classId: rep.classId,
        className: rep.className,
        a: snap(a),
        b: snap(b),
        seed,
        choice,
        choiceAt: Number.isFinite(at) ? at : undefined,
        playerWon: rep.playerWon,
        loserDies: rep.loserDies,
        lines: rep.lines,
        gear: mergeLoot(rep.gear),
        trashed: rep.trashed,
      },
    },
    opts.now,
  );
}
