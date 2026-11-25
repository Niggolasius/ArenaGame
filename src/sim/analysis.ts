// Massensimulation und die Abnahme-Analysen für das Test-Tool und das Balance-Skript.

import { simulate } from './combat';
import type { Config } from './config';
import { even, makeGladiator, makeStone, randomStatsGladiator, withStone } from './factory';
import { deriveSeed, mulberry32 } from './rng';
import { formulaP, kFactorFromP, power, RARITY_NAMES } from './stats';
import type { Gladiator, Rarity, Stance, StoneKind, Style } from './types';

export type Progress = (done: number, total: number) => void;

export interface MassResult {
  n: number;
  winsA: number;
  p: number;
  ci95: number; // halbe Breite des 95-%-Intervalls
  avgSeconds: number;
  timeouts: number;
  avgHits: number;
}

export function massSim(a: Gladiator, b: Gladiator, n: number, seed: number, cfg: Config, progress?: Progress): MassResult {
  let wins = 0;
  let secs = 0;
  let timeouts = 0;
  let hits = 0;
  for (let i = 0; i < n; i++) {
    // Seiten tauschen sich ab, damit die Startposition nichts verzerrt.
    const swap = i % 2 === 1;
    const r = swap ? simulate(b, a, deriveSeed(seed, i), cfg) : simulate(a, b, deriveSeed(seed, i), cfg);
    const aWon = swap ? r.winner === 1 : r.winner === 0;
    if (aWon) wins++;
    secs += r.seconds;
    hits += r.hits[0] + r.hits[1];
    if (r.seconds >= cfg.sim.maxSeconds) timeouts++;
    if (progress && i % 500 === 0) progress(i, n);
  }
  const p = wins / n;
  return {
    n,
    winsA: wins,
    p,
    ci95: 1.96 * Math.sqrt((p * (1 - p)) / n),
    avgSeconds: secs / n,
    timeouts,
    avgHits: hits / n,
  };
}

export interface Report {
  id: string;
  title: string;
  ok: boolean;
  summary: string[];
  head: string[];
  rows: (string | number)[][];
  points?: { x: number; y: number }[]; // für Diagramme: vorhergesagt gegen gemessen
}

const pct = (v: number) => `${(v * 100).toFixed(1)} %`;
/** Wie stark eine Messung allein durch Zufall schwankt (95 %), bei p um 50 %. */
const noise = (n: number) =>
  `Zufallsschwankung bei ${n} Kämpfen: etwa ±${((1.96 * 0.5) / Math.sqrt(n) * 100).toFixed(1)} Prozentpunkte. Für Entscheidungen 10.000 oder mehr nehmen.`;
const pp = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}`;

/** 1. Passt P = K^e / (K^e + K^e) zur Simulation? Zufällige Paare über die ganze Stat-Spanne. */
export function formulaCheck(cfg: Config, pairs: number, fights: number, seed: number, progress?: Progress): Report {
  const rng = mulberry32(seed);
  const pts: { x: number; y: number; lr: number; w: number; label: string }[] = [];
  for (let i = 0; i < pairs; i++) {
    const style: Style = (['schwer', 'flink', 'speer'] as Style[])[i % 3];
    let a = randomStatsGladiator(rng, cfg, style);
    let b = randomStatsGladiator(rng, cfg, style);
    let kA = power(a, cfg);
    let kB = power(b, cfg);
    if (kA < kB) [a, b, kA, kB] = [b, a, kB, kA];
    if (kA / kB > 3) continue; // extreme Paare tragen nichts bei
    const m = massSim(a, b, fights, deriveSeed(seed, 1000 + i), cfg);
    const st = (g: Gladiator) => `${g.style} ${g.base.atk}/${g.base.def}/${g.base.hp}/${g.base.spd}`;
    pts.push({ x: formulaP(kA, kB, cfg.formulaExponent), y: m.p, lr: Math.log(kA / kB), w: fights, label: `${st(a)} gegen ${st(b)}` });
    progress?.(i, pairs);
  }
  // Exponent schätzen: logit(p) = e * ln(kA/kB), gewichtete kleinste Quadrate.
  let sxy = 0;
  let sxx = 0;
  for (const p of pts) {
    const y = Math.min(0.995, Math.max(0.005, p.y));
    const wt = p.w * y * (1 - y);
    sxy += wt * p.lr * Math.log(y / (1 - y));
    sxx += wt * p.lr * p.lr;
  }
  const exp = sxy / sxx;
  const bins: { n: number; pred: number; meas: number }[] = Array.from({ length: 5 }, () => ({ n: 0, pred: 0, meas: 0 }));
  for (const p of pts) {
    const k = Math.min(4, Math.floor((p.x - 0.5) / 0.1));
    bins[k].n++;
    bins[k].pred += p.x;
    bins[k].meas += p.y;
  }
  const dev = pts.map((p) => Math.abs(p.y - p.x));
  const meanDev = dev.reduce((s, v) => s + v, 0) / dev.length;
  const maxDev = Math.max(...dev);
  const worst = pts[dev.indexOf(maxDev)];
  const rows = bins
    .map((b, i) =>
      b.n ? [`${50 + i * 10}–${60 + i * 10} %`, b.n, pct(b.pred / b.n), pct(b.meas / b.n), pp(b.meas / b.n - b.pred / b.n)] : null,
    )
    .filter(Boolean) as (string | number)[][];
  return {
    id: 'formel',
    title: 'Formel gegen Simulation',
    ok: meanDev <= 0.03,
    summary: [
      `Gemessener Exponent: ${exp.toFixed(2)} (Formel nutzt ${cfg.formulaExponent})`,
      `Mittlere Abweichung: ${(meanDev * 100).toFixed(1)} Prozentpunkte, größte: ${(maxDev * 100).toFixed(1)}`,
      `Größte Abweichung bei ${worst.label} (ATK/DEF/HP/SPD): Formel ${pct(worst.x)}, gemessen ${pct(worst.y)}`,
      `${pts.length} Paare mit je ${fights} Kämpfen. Ziel: höchstens 3 Prozentpunkte im Mittel.`,
    ],
    head: ['Formel sagt', 'Paare', 'Formel im Mittel', 'Gemessen', 'Abweichung (pp)'],
    rows,
    points: pts.map((p) => ({ x: p.x, y: p.y })),
  };
}

const STANCES: Stance[] = ['aggressiv', 'ausweichend', 'defensiv'];
const BEATS: Record<Stance, Stance> = { aggressiv: 'ausweichend', ausweichend: 'defensiv', defensiv: 'aggressiv' };

/** 2. Wie stark wirken die Haltungs-Konter bei gleicher Kraft? Ziel: +5 bis +8 Prozentpunkte. */
export function stanceCheck(cfg: Config, fights: number, seed: number, progress?: Progress): Report {
  const rows: (string | number)[][] = [];
  const counters: number[] = [];
  let step = 0;
  for (const sa of STANCES) {
    for (const sb of STANCES) {
      const a = makeGladiator({ base: even(7), orders: { stance: sa } });
      const b = makeGladiator({ base: even(7), orders: { stance: sb } });
      const m = massSim(a, b, fights, deriveSeed(seed, step), cfg);
      const rel = BEATS[sa] === sb ? 'Konter' : BEATS[sb] === sa ? 'wird gekontert' : 'gleich';
      if (rel === 'Konter') counters.push(m.p - 0.5);
      rows.push([sa, sb, rel, pct(m.p), pp(m.p - 0.5)]);
      progress?.(++step, 9);
    }
  }
  const avg = counters.reduce((s, v) => s + v, 0) / counters.length;
  const min = Math.min(...counters);
  const max = Math.max(...counters);
  return {
    id: 'haltung',
    title: 'Haltungs-Konter',
    ok: min >= 0.045 && max <= 0.085,
    summary: [
      `Konter bringt im Mittel ${pp(avg)} Prozentpunkte (Spanne ${pp(min)} bis ${pp(max)}).`,
      'Ziel: +5 bis +8. Beide Gladiatoren haben alle Stats auf 7 und den Kampfstil Speer.',
      noise(fights),
    ],
    head: ['Haltung A', 'Haltung B', 'Verhältnis', 'A gewinnt', 'Abstand zu 50 % (pp)'],
    rows,
  };
}

/** 3. Was ist ein Stein wirklich wert? Derselbe Gladiator mit und ohne Stein, umgerechnet in einen K-Faktor. */
export function stoneCheck(cfg: Config, fights: number, seed: number, baseStat = 8, progress?: Progress): Report {
  const tests: { label: string; rarity: Rarity; kind: StoneKind }[] = [];
  for (const r of ['epic', 'legendary', 'mythic'] as Rarity[]) {
    tests.push({ label: 'Krit', rarity: r, kind: { type: 'krit' } });
    tests.push({ label: 'Blutdurst', rarity: r, kind: { type: 'blutdurst' } });
  }
  tests.push({ label: 'Zorn', rarity: 'mythic', kind: { type: 'zorn' } });
  tests.push({ label: 'Dornen', rarity: 'mythic', kind: { type: 'dornen' } });
  tests.push({ label: 'Erstschlag', rarity: 'mythic', kind: { type: 'erstschlag' } });
  tests.push({ label: 'Fluch', rarity: 'mythic', kind: { type: 'fluch' } });
  for (const r of ['common', 'rare', 'epic', 'legendary'] as Rarity[]) {
    tests.push({ label: 'Grundstein ATK', rarity: r, kind: { type: 'base', stat: 'atk', value: 0 } });
  }

  const base = makeGladiator({ base: even(baseStat) });
  const rows: (string | number)[][] = [];
  let ok = true;
  tests.forEach((t, i) => {
    const a = withStone(base, makeStone(t.rarity, t.kind));
    const m = massSim(a, base, fights, deriveSeed(seed, i), cfg);
    const kf = kFactorFromP(m.p, cfg.formulaExponent);
    const isSpecial = t.kind.type !== 'base';
    const set = isSpecial ? cfg.kSurcharge[t.rarity] ?? 1 : power(a, cfg) / power(base, cfg);
    const delta = m.p - 0.5;
    const ruleOk = !isSpecial || Math.abs(kf - set) <= cfg.stoneTolerance;
    if (!ruleOk) ok = false;
    rows.push([
      t.label,
      RARITY_NAMES[t.rarity],
      pct(m.p),
      pp(delta),
      `×${kf.toFixed(3)}`,
      `×${set.toFixed(3)}`,
      isSpecial ? (ruleOk ? 'passt' : kf > set ? 'zu stark' : 'zu schwach') : 'Stat-Stein',
    ]);
    progress?.(i + 1, tests.length);
  });
  return {
    id: 'steine',
    title: 'Steine als Kraft-Aufschlag',
    ok,
    summary: [
      `Gegner: derselbe Gladiator ohne Stein (alle Stats ${baseStat}). ${fights} Kämpfe pro Zeile.`,
      'Gemessener K-Faktor = welcher Kraft-Aufschlag die gemessene Siegquote nach der Formel erklärt.',
      noise(fights),
      `Regel: Der gemessene K-Faktor eines Sondersteins liegt höchstens ${cfg.stoneTolerance.toFixed(2)} neben dem eingestellten Aufschlag.`,
    ],
    head: ['Stein', 'Seltenheit', 'Siegquote', 'Plus (pp)', 'Gemessener K-Faktor', 'Eingestellt', 'Ergebnis'],
    rows,
  };
}

/** 4. Siegquote am Klassenrand: der Schwächste gegen den Stärksten einer Klasse. */
export function classEdgeCheck(cfg: Config, fights: number, seed: number, progress?: Progress): Report {
  const kMin = Math.sqrt(1.5 * cfg.statMin * 2 * cfg.statMin);
  const kMax = Math.sqrt(1.5 * cfg.statCap * 2 * cfg.statCap);
  const rows: (string | number)[][] = [];
  cfg.arena.classes.forEach((c, i) => {
    const lo = Math.max(c.minK, kMin);
    const hi = Math.min(c.maxK - 0.01, kMax);
    if (hi <= lo) return;
    // Modell-Gladiatoren mit gleichen Stats, so gewählt, dass K genau am Rand liegt.
    const a = makeGladiator({ base: even(hi / Math.sqrt(3)) });
    const b = makeGladiator({ base: even(lo / Math.sqrt(3)) });
    const m = massSim(a, b, fights, deriveSeed(seed, i), cfg);
    rows.push([c.name, `${lo.toFixed(1)} – ${hi.toFixed(1)}`, pct(formulaP(hi, lo, cfg.formulaExponent)), pct(m.p)]);
    progress?.(i + 1, cfg.arena.classes.length);
  });
  return {
    id: 'klassen',
    title: 'Siegquote am Klassenrand',
    ok: true,
    summary: [
      'Stärkster gegen Schwächsten derselben Klasse, als Modell-Gladiatoren mit gleichen Stats.',
      'Je höher die Quote, desto weiter sollte man die Klasse aufteilen oder die Grenzen verschieben.',
    ],
    head: ['Klasse', 'Kraft-Spanne', 'Formel', 'Gemessen'],
    rows,
  };
}

/** 5. Sind die Kampfstile bei gleicher Kraft ausgeglichen? */
export function styleCheck(cfg: Config, fights: number, seed: number, progress?: Progress): Report {
  const styles: Style[] = ['schwer', 'flink', 'speer'];
  const rows: (string | number)[][] = [];
  let worst = 0;
  let step = 0;
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      const a = makeGladiator({ style: styles[i], base: even(7) });
      const b = makeGladiator({ style: styles[j], base: even(7) });
      const m = massSim(a, b, fights, deriveSeed(seed, step), cfg);
      worst = Math.max(worst, Math.abs(m.p - 0.5));
      rows.push([styles[i], styles[j], pct(m.p), pp(m.p - 0.5), `${m.avgSeconds.toFixed(1)} s`]);
      progress?.(++step, 3);
    }
  }
  return {
    id: 'stile',
    title: 'Kampfstile bei gleicher Kraft',
    ok: worst <= 0.03,
    summary: ['Alle Stats auf 7, jeder Stil mit seiner Lieblingsdistanz. Ziel: höchstens 3 Prozentpunkte Abstand zu 50 %.'],
    head: ['Stil A', 'Stil B', 'A gewinnt', 'Abstand (pp)', 'Kampfdauer'],
    rows,
  };
}

export type AnalysisId = 'formel' | 'haltung' | 'steine' | 'klassen' | 'stile';

export function runAnalysis(id: AnalysisId, cfg: Config, fights: number, seed: number, progress?: Progress): Report {
  switch (id) {
    case 'formel':
      return formulaCheck(cfg, 240, Math.max(300, Math.round(fights / 10)), seed, progress);
    case 'haltung':
      return stanceCheck(cfg, fights, seed, progress);
    case 'steine':
      return stoneCheck(cfg, fights, seed, 8, progress);
    case 'klassen':
      return classEdgeCheck(cfg, fights, seed, progress);
    case 'stile':
      return styleCheck(cfg, fights, seed, progress);
  }
}
