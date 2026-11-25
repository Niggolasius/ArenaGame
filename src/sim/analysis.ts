// Massensimulation und die Abnahme-Analysen für das Test-Tool und das Balance-Skript.

import { simulate } from './combat';
import type { Config } from './config';
import { even, makeGladiator, makeStone, randomStatsGladiator, withStone } from './factory';
import { deriveSeed, mulberry32 } from './rng';
import { DISTANCE_NAMES, LAST_STAND_NAMES, RARITY_NAMES, STANCE_NAMES, STONE_NAMES, STYLE_NAMES } from './names';
import { formulaP, kFactorFromP, power } from './stats';
import type { Gladiator, LastStand, Rarity, Stance, Stats, StoneKind, Style } from './types';

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
  `Random noise at ${n.toLocaleString('en-US')} fights: about ±${((1.96 * 0.5) / Math.sqrt(n) * 100).toFixed(1)} percentage points. Use 10,000 or more before deciding anything.`;
const pp = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}`;

/** 1. Passt P = K^e / (K^e + K^e) zur Simulation? Zufällige Paare über die ganze Stat-Spanne. */
export function formulaCheck(cfg: Config, pairs: number, fights: number, seed: number, progress?: Progress): Report {
  const rng = mulberry32(seed);
  const pts: { x: number; y: number; lr: number; w: number; label: string }[] = [];
  for (let i = 0; i < pairs; i++) {
    const style: Style = (['heavy', 'swift', 'spear'] as Style[])[i % 3];
    let a = randomStatsGladiator(rng, cfg, style);
    let b = randomStatsGladiator(rng, cfg, style);
    let kA = power(a, cfg);
    let kB = power(b, cfg);
    if (kA < kB) [a, b, kA, kB] = [b, a, kB, kA];
    if (kA / kB > 3) continue; // extreme Paare tragen nichts bei
    const m = massSim(a, b, fights, deriveSeed(seed, 1000 + i), cfg);
    const st = (g: Gladiator) => `${STYLE_NAMES[g.style]} ${g.base.atk}/${g.base.def}/${g.base.hp}/${g.base.spd}`;
    pts.push({ x: formulaP(kA, kB, cfg.formulaExponent), y: m.p, lr: Math.log(kA / kB), w: fights, label: `${st(a)} vs ${st(b)}` });
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
    id: 'formula',
    title: 'Formula vs simulation',
    ok: meanDev <= 0.03,
    summary: [
      `Measured exponent: ${exp.toFixed(2)} (formula uses ${cfg.formulaExponent})`,
      `Mean deviation: ${(meanDev * 100).toFixed(1)} percentage points, largest: ${(maxDev * 100).toFixed(1)}`,
      `Largest deviation: ${worst.label} (ATK/DEF/HP/SPD), formula ${pct(worst.x)}, measured ${pct(worst.y)}`,
      `${pts.length} pairs with ${fights} fights each. Target: at most 3 percentage points on average.`,
    ],
    head: ['Formula says', 'Pairs', 'Formula avg', 'Measured', 'Deviation (pp)'],
    rows,
    points: pts.map((p) => ({ x: p.x, y: p.y })),
  };
}

const STANCES: Stance[] = ['aggressive', 'evasive', 'defensive'];
const BEATS: Record<Stance, Stance> = { aggressive: 'evasive', evasive: 'defensive', defensive: 'aggressive' };

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
      const rel = BEATS[sa] === sb ? 'counters' : BEATS[sb] === sa ? 'is countered' : 'even';
      if (rel === 'counters') counters.push(m.p - 0.5);
      rows.push([STANCE_NAMES[sa], STANCE_NAMES[sb], rel, pct(m.p), pp(m.p - 0.5)]);
      step++;
      progress?.(step, 9);
    }
  }
  const avg = counters.reduce((s, v) => s + v, 0) / counters.length;
  const min = Math.min(...counters);
  const max = Math.max(...counters);
  return {
    id: 'stance',
    title: 'Stance counters',
    ok: min >= 0.045 && max <= 0.085,
    summary: [
      `A counter is worth ${pp(avg)} percentage points on average (range ${pp(min)} to ${pp(max)}).`,
      'Target: +5 to +8. Both gladiators have all stats at 7 and the Spear style.',
      noise(fights),
    ],
    head: ['Stance A', 'Stance B', 'Relation', 'A wins', 'vs 50 % (pp)'],
    rows,
  };
}

/** 3. Was ist ein Stein wirklich wert? Derselbe Gladiator mit und ohne Stein, umgerechnet in einen K-Faktor. */
export function stoneCheck(cfg: Config, fights: number, seed: number, baseStat = 8, progress?: Progress): Report {
  const tests: { label: string; rarity: Rarity; kind: StoneKind }[] = [];
  for (const r of ['epic', 'legendary', 'mythic'] as Rarity[]) {
    tests.push({ label: 'Crit', rarity: r, kind: { type: 'crit' } });
    tests.push({ label: 'Bloodthirst', rarity: r, kind: { type: 'bloodthirst' } });
  }
  tests.push({ label: 'Wrath', rarity: 'mythic', kind: { type: 'wrath' } });
  tests.push({ label: 'Thorns', rarity: 'mythic', kind: { type: 'thorns' } });
  tests.push({ label: 'First Strike', rarity: 'mythic', kind: { type: 'firstStrike' } });
  tests.push({ label: 'Curse', rarity: 'mythic', kind: { type: 'curse' } });
  for (const r of ['common', 'rare', 'epic', 'legendary'] as Rarity[]) {
    tests.push({ label: 'Base Stone ATK', rarity: r, kind: { type: 'base', stat: 'atk', value: 0 } });
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
      isSpecial ? (ruleOk ? 'fits' : kf > set ? 'too strong' : 'too weak') : 'stat stone',
    ]);
    progress?.(i + 1, tests.length);
  });
  return {
    id: 'stones',
    title: 'Stones as power bonus',
    ok,
    summary: [
      `Opponent: the same gladiator without the stone (all stats ${baseStat}). ${fights} fights per row.`,
      'Measured K factor = the power bonus that explains the measured win rate under the formula.',
      noise(fights),
      `Rule: a special stone's measured K factor is within ${cfg.stoneTolerance.toFixed(2)} of its configured bonus.`,
    ],
    head: ['Stone', 'Rarity', 'Win rate', 'Gain (pp)', 'Measured K factor', 'Configured', 'Result'],
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
    id: 'classes',
    title: 'Win rate at class edges',
    ok: true,
    summary: [
      'Strongest vs weakest of the same class, as model gladiators with even stats.',
      'The higher the rate, the more the class should be split or its edges moved.',
    ],
    head: ['Class', 'Power range', 'Formula', 'Measured'],
    rows,
  };
}

/** 5. Sind die Kampfstile bei gleicher Kraft ausgeglichen? */
export function styleCheck(cfg: Config, fights: number, seed: number, progress?: Progress): Report {
  const styles: Style[] = ['heavy', 'swift', 'spear'];
  const rows: (string | number)[][] = [];
  let worst = 0;
  let step = 0;
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      const a = makeGladiator({ style: styles[i], base: even(7) });
      const b = makeGladiator({ style: styles[j], base: even(7) });
      const m = massSim(a, b, fights, deriveSeed(seed, step), cfg);
      worst = Math.max(worst, Math.abs(m.p - 0.5));
      rows.push([STYLE_NAMES[styles[i]], STYLE_NAMES[styles[j]], pct(m.p), pp(m.p - 0.5), `${m.avgSeconds.toFixed(1)} s`]);
      step++;
      progress?.(step, 3);
    }
  }
  return {
    id: 'styles',
    title: 'Fighting styles at equal power',
    ok: worst <= 0.03,
    summary: ['All stats at 7, each style at its preferred distance. Target: at most 3 percentage points from 50 %.'],
    head: ['Style A', 'Style B', 'A wins', 'vs 50 % (pp)', 'Fight length'],
    rows,
  };
}


/** 6. Letztes Gefecht: Ist „Alles geben“ oder „Durchhalten“ besser als Normal? Beides soll eine Wahl sein, keine Pflicht. */
export function lastStandCheck(cfg: Config, fights: number, seed: number, progress?: Progress): Report {
  const opts: LastStand[] = ['normal', 'allIn', 'holdOut'];
  const names = LAST_STAND_NAMES;
  const rows: (string | number)[][] = [];
  let worst = 0;
  let step = 0;
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      const a = makeGladiator({ base: even(7), orders: { lastStand: opts[j] } });
      const b = makeGladiator({ base: even(7), orders: { lastStand: opts[i] } });
      const m = massSim(a, b, fights, deriveSeed(seed, step), cfg);
      worst = Math.max(worst, Math.abs(m.p - 0.5));
      rows.push([names[opts[j]], names[opts[i]], pct(m.p), pp(m.p - 0.5)]);
      step++;
      progress?.(step, 3);
    }
  }
  return {
    id: 'lastStand',
    title: 'Last Stand',
    ok: worst <= 0.03,
    summary: [
      `The order kicks in below ${Math.round(cfg.lastStand.threshold * 100)} % HP. Target: no choice is more than 3 percentage points better.`,
      noise(fights),
    ],
    head: ['Order A', 'Order B', 'A wins', 'vs 50 % (pp)'],
    rows,
  };
}

/** 7. Was bringt die passende Distanz? Jeder Stil mit Lieblingsdistanz gegen sich selbst mit der falschen. */
export function distanceCheck(cfg: Config, fights: number, seed: number, progress?: Progress): Report {
  const styles: Style[] = ['heavy', 'swift', 'spear'];
  const rows: (string | number)[][] = [];
  let ok = true;
  styles.forEach((st, i) => {
    const good = cfg.styles[st].prefers;
    const bad = good === 'near' ? 'far' : 'near';
    const a = makeGladiator({ style: st, base: even(7), orders: { distance: good } });
    const b = makeGladiator({ style: st, base: even(7), orders: { distance: bad } });
    const m = massSim(a, b, fights, deriveSeed(seed, i), cfg);
    const d = m.p - 0.5;
    if (d < 0 || d > 0.05) ok = false;
    rows.push([STYLE_NAMES[st], DISTANCE_NAMES[good], DISTANCE_NAMES[bad], pct(m.p), pp(d)]);
    progress?.(i + 1, 3);
  });
  return {
    id: 'distance',
    title: 'Preferred distance',
    ok,
    summary: [
      `The preferred distance gives +${Math.round(cfg.distanceBonus * 100)} % damage. Target: a small but real edge of 0 to +5 percentage points.`,
      noise(fights),
    ],
    head: ['Style', 'Preferred', 'Wrong', 'Preferred wins', 'Edge (pp)'],
    rows,
  };
}

/** 8. Sind Sondersteine bei schwachen und starken Gladiatoren gleich viel wert? */
export function stoneLevelCheck(cfg: Config, fights: number, seed: number, progress?: Progress): Report {
  const tests: { label: string; rarity: Rarity; kind: StoneKind }[] = [];
  for (const r of ['epic', 'legendary'] as Rarity[]) {
    tests.push({ label: 'Crit', rarity: r, kind: { type: 'crit' } });
    tests.push({ label: 'Bloodthirst', rarity: r, kind: { type: 'bloodthirst' } });
  }
  for (const t of ['crit', 'bloodthirst', 'wrath', 'thorns', 'firstStrike', 'curse'] as const) {
    tests.push({ label: STONE_NAMES[t], rarity: 'mythic', kind: { type: t } as StoneKind });
  }
  // Verschiedene Bauarten, denn bei gleichen Stats skaliert die Simulation exakt mit und alle Stufen wären gleich.
  const builds: { name: string; base: Stats }[] = [
    { name: 'Weak 3', base: even(3) },
    { name: 'Glass Cannon', base: { atk: 11, def: 3, hp: 4, spd: 9 } },
    { name: 'Tank', base: { atk: 3, def: 11, hp: 11, spd: 3 } },
    { name: 'Whirlwind', base: { atk: 4, def: 5, hp: 5, spd: 13 } },
    { name: 'Strong 11', base: even(11) },
  ];
  const rows: (string | number)[][] = [];
  let ok = true;
  let step = 0;
  for (const t of tests) {
    const set = cfg.kSurcharge[t.rarity] ?? 1;
    const kfs = builds.map((bd) => {
      const base = makeGladiator({ base: bd.base });
      const m = massSim(withStone(base, makeStone(t.rarity, t.kind)), base, fights, deriveSeed(seed, step), cfg);
      step++;
      progress?.(step, tests.length * builds.length);
      return kFactorFromP(m.p, cfg.formulaExponent);
    });
    const mean = kfs.reduce((a, b) => a + b, 0) / kfs.length;
    const top = Math.max(...kfs);
    // Ein Stein darf bei einer Bauart schwächer sein (Vielfalt), aber nirgends übermächtig und im Schnitt passend.
    const verdict = top > set + cfg.stoneTolerance * 2.5 ? `too strong for ${builds[kfs.indexOf(top)].name}` : Math.abs(mean - set) > cfg.stoneTolerance ? (mean > set ? 'too strong on average' : 'too weak on average') : 'fits';
    if (verdict !== 'fits') ok = false;
    rows.push([t.label, RARITY_NAMES[t.rarity], ...kfs.map((k) => `×${k.toFixed(3)}`), `×${mean.toFixed(3)}`, `×${set.toFixed(3)}`, verdict]);
  }
  return {
    id: 'stoneBuilds',
    title: 'Stones across builds',
    ok,
    summary: [
      `Measured K factor for different builds (ATK/DEF/HP/SPD): ${builds.map((b) => `${b.name} ${b.base.atk}/${b.base.def}/${b.base.hp}/${b.base.spd}`).join(', ')}.`,
      `Target: within ${cfg.stoneTolerance.toFixed(2)} of the bonus on average and never more than ${(cfg.stoneTolerance * 2.5).toFixed(2)} above it for any build. Weaker for one build is fine, that is build variety.`,
      noise(fights),
    ],
    head: ['Stone', 'Rarity', ...builds.map((b) => b.name), 'Average', 'Configured', 'Result'],
    rows,
  };
}

export type AnalysisId = 'formula' | 'stance' | 'stones' | 'stoneBuilds' | 'lastStand' | 'distance' | 'classes' | 'styles';

export function runAnalysis(id: AnalysisId, cfg: Config, fights: number, seed: number, progress?: Progress): Report {
  switch (id) {
    case 'formula':
      return formulaCheck(cfg, 240, Math.max(300, Math.round(fights / 10)), seed, progress);
    case 'stance':
      return stanceCheck(cfg, fights, seed, progress);
    case 'stones':
      return stoneCheck(cfg, fights, seed, 8, progress);
    case 'classes':
      return classEdgeCheck(cfg, fights, seed, progress);
    case 'styles':
      return styleCheck(cfg, fights, seed, progress);
    case 'lastStand':
      return lastStandCheck(cfg, fights, seed, progress);
    case 'distance':
      return distanceCheck(cfg, fights, seed, progress);
    case 'stoneBuilds':
      return stoneLevelCheck(cfg, Math.max(2000, Math.round(fights / 2)), seed, progress);
  }
}
