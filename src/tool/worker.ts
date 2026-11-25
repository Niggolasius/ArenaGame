// Rechnet Massensimulationen und Analysen im Hintergrund, damit die Seite nicht einfriert.

import { massSim, runAnalysis, type AnalysisId } from '../sim/analysis';
import type { Config } from '../sim/config';
import type { Gladiator } from '../sim/types';

export type WorkerRequest =
  | { job: number; type: 'mass'; a: Gladiator; b: Gladiator; n: number; seed: number; cfg: Config }
  | { job: number; type: 'analysis'; id: AnalysisId; n: number; seed: number; cfg: Config };

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const r = e.data;
  const progress = (done: number, total: number) => postMessage({ job: r.job, type: 'progress', done, total });
  const t0 = performance.now();
  const result =
    r.type === 'mass' ? massSim(r.a, r.b, r.n, r.seed, r.cfg, progress) : runAnalysis(r.id, r.cfg, r.n, r.seed, progress);
  postMessage({ job: r.job, type: 'done', result, ms: performance.now() - t0 });
};
