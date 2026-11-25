// Alle Analysen ohne Browser: npm run balance [-- formula stance stones stoneBuilds lastStand distance classes styles] [--n 10000] [--seed 1]
import { runAnalysis, massSim, type AnalysisId, type Report } from '../src/sim/analysis';
import { DEFAULT_CONFIG } from '../src/sim/config';
import { even, makeGladiator } from '../src/sim/factory';

const args = process.argv.slice(2);
const opt = (name: string, def: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const n = opt('n', 10000);
const seed = opt('seed', 1);
const all: AnalysisId[] = ['formula', 'stance', 'stones', 'stoneBuilds', 'lastStand', 'distance', 'classes', 'styles'];
const ids = args.filter((a: string) => (all as string[]).includes(a)) as AnalysisId[];

function print(r: Report) {
  console.log(`\n=== ${r.title} ${r.ok ? '[OK]' : '[CHECK]'}`);
  for (const s of r.summary) console.log('  ' + s);
  const w = r.head.map((h, i) => Math.max(h.length, ...r.rows.map((row) => String(row[i]).length)));
  const line = (cells: (string | number)[]) => '  ' + cells.map((c, i) => String(c).padEnd(w[i])).join(' | ');
  console.log(line(r.head));
  for (const row of r.rows) console.log(line(row));
}

const t0 = performance.now();
const m = massSim(makeGladiator({ base: even(7) }), makeGladiator({ base: even(7) }), 10000, seed, DEFAULT_CONFIG);
console.log(`Speed: 10,000 fights in ${((performance.now() - t0) / 1000).toFixed(2)} s, Ø ${m.avgSeconds.toFixed(1)} s avg fight, ${m.timeouts} timeouts`);

for (const id of ids.length ? ids : all) {
  const t = performance.now();
  print(runAnalysis(id, DEFAULT_CONFIG, n, seed));
  console.log(`  (${((performance.now() - t) / 1000).toFixed(1)} s)`);
}
