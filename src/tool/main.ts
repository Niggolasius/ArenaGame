// Das Test-Tool: Gladiatoren bauen, einzeln und massenhaft kämpfen lassen, Balance-Analysen, alle Zahlen einstellen.

import './style.css';
import type { AnalysisId, MassResult, Report } from '../sim/analysis';
import { simulate } from '../sim/combat';
import { DEFAULT_CONFIG, type Config } from '../sim/config';
import { makeGladiator, makeItem, makeStone, randomGladiator } from '../sim/factory';
import { mulberry32 } from '../sim/rng';
import {
  arenaClass,
  effectiveStats,
  formulaP,
  kFactorFromP,
  power,
  RARITY_NAMES,
  specialStones,
  STAT_KEYS,
} from '../sim/stats';
import type { FightEvent, FightResult, Gladiator, Rarity, Slot, StatKey, Stone, Style } from '../sim/types';
import { loadConfig, loadState, mergeConfig, saveConfig, saveState } from './store';
import type { WorkerRequest } from './worker';

// ---------- kleine Helfer ----------

type Child = Node | string | number | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k in el) (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
const $ = (id: string) => document.getElementById(id)!;
const num = (v: number, d = 1) => v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v: number, d = 1) => `${num(v * 100, d)} %`;
const pp = (v: number) => `${v >= 0 ? '+' : '−'}${num(Math.abs(v * 100))} pp`;
function money(silver: number): string {
  const g = Math.floor(silver / 100);
  const s = silver % 100;
  if (g && s) return `${g.toLocaleString('de-DE')} Gold ${s} Silber`;
  return g ? `${g.toLocaleString('de-DE')} Gold` : `${s} Silber`;
}

const STAT_NAMES: Record<StatKey, string> = { atk: 'ATK', def: 'DEF', hp: 'HP', spd: 'SPD' };
const STYLE_NAMES: Record<Style, string> = { schwer: 'Schwer', flink: 'Flink', speer: 'Speer' };
const SLOT_NAMES: Record<Slot, string> = { waffe: 'Waffe', ruestung: 'Rüstung', amulett: 'Amulett' };
const SLOTS: Slot[] = ['waffe', 'ruestung', 'amulett'];
const RARITIES: Rarity[] = ['common', 'rare', 'epic', 'legendary', 'mythic'];
const SPECIAL_NAMES: Record<string, string> = {
  krit: 'Krit',
  blutdurst: 'Blutdurst',
  zorn: 'Zorn',
  dornen: 'Dornen',
  erstschlag: 'Erstschlag',
  fluch: 'Fluch',
};

// ---------- Zustand ----------

interface State {
  tab: 'duell' | 'analysen' | 'config';
  a: Gladiator;
  b: Gladiator;
  seed: number;
  n: number;
  anaN: number;
  anaSeed: number;
}

let cfg: Config = loadConfig();

function withSlots(g: Gladiator): Gladiator {
  const items = SLOTS.map((s) => g.items.find((it) => it.slot === s) ?? makeItem(s, 'common', {}, 0, []));
  return { ...g, items };
}

const saved = loadState<State>();
const state: State = {
  tab: saved?.tab ?? 'duell',
  a: withSlots(saved?.a ?? makeGladiator({ name: 'Brutus', style: 'schwer', base: { atk: 7, def: 6, hp: 7, spd: 4 } })),
  b: withSlots(saved?.b ?? makeGladiator({ name: 'Velox', style: 'flink', base: { atk: 5, def: 5, hp: 6, spd: 9 } })),
  seed: saved?.seed ?? 1,
  n: saved?.n ?? 10000,
  anaN: saved?.anaN ?? 10000,
  anaSeed: saved?.anaSeed ?? 1,
};
const persist = () => saveState(state);

// ---------- Worker ----------

let worker: Worker | null = null;
let jobId = 0;
let pending: { id: number; resolve: (v: { result: unknown; ms: number }) => void; reject: (e: Error) => void; onProgress?: (d: number, t: number) => void } | null = null;

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const m = e.data;
    if (!pending || m.job !== pending.id) return;
    if (m.type === 'progress') pending.onProgress?.(m.done, m.total);
    else {
      const p = pending;
      pending = null;
      p.resolve({ result: m.result, ms: m.ms });
    }
  };
  worker.onerror = (e) => {
    const p = pending;
    pending = null;
    p?.reject(new Error(e.message));
  };
  return worker;
}

type JobRequest = WorkerRequest extends infer R ? (R extends WorkerRequest ? Omit<R, 'job'> : never) : never;

function runJob<T>(req: JobRequest, onProgress?: (d: number, t: number) => void): Promise<{ result: T; ms: number }> {
  cancelJob();
  const id = ++jobId;
  return new Promise((resolve, reject) => {
    pending = { id, resolve: resolve as (v: { result: unknown; ms: number }) => void, reject, onProgress };
    getWorker().postMessage({ ...req, job: id, cfg: JSON.parse(JSON.stringify(req.cfg)) });
    setBusy(true);
  }).finally(() => setBusy(false)) as Promise<{ result: T; ms: number }>;
}

function cancelJob() {
  if (pending) {
    worker?.terminate();
    worker = null;
    pending.reject(new Error('abgebrochen'));
    pending = null;
  }
}

function setBusy(on: boolean) {
  document.body.classList.toggle('busy', on);
  if (!on) setProgress(0, 0);
}
function setProgress(done: number, total: number) {
  const bar = document.getElementById('progress');
  if (bar) bar.style.width = total ? `${Math.min(100, (done / total) * 100)}%` : '0';
}

// ---------- Seitenrahmen ----------

function render() {
  const app = $('app');
  app.replaceChildren(
    h(
      'header',
      { class: 'top' },
      h('div', { class: 'brand' }, h('span', { class: 'logo' }, '⚔'), h('div', {}, h('h1', {}, 'Arena'), h('small', {}, 'Test-Tool · Meilenstein 1'))),
      h(
        'nav',
        { class: 'tabs' },
        ...(
          [
            ['duell', 'Duell'],
            ['analysen', 'Analysen'],
            ['config', 'Einstellungen'],
          ] as const
        ).map(([id, label]) =>
          h(
            'button',
            {
              class: `tab ${state.tab === id ? 'on' : ''}`,
              onclick: () => {
                state.tab = id;
                persist();
                render();
              },
            },
            label,
          ),
        ),
      ),
      h('button', { class: 'btn ghost cancel', onclick: cancelJob, title: 'Laufende Rechnung abbrechen' }, 'Abbrechen'),
    ),
    h('div', { class: 'progress' }, h('div', { id: 'progress' })),
    h('main', { id: 'view' }),
  );
  const view = $('view');
  if (state.tab === 'duell') renderDuel(view);
  else if (state.tab === 'analysen') renderAnalyses(view);
  else renderConfig(view);
}

// ---------- Duell ----------

function stoneValue(s: Stone | undefined): string {
  if (!s) return '';
  if (s.kind.type === 'base') return `base:${s.kind.stat}:${s.rarity}`;
  return `${s.kind.type}:${s.rarity}`;
}
function parseStone(v: string): Stone | null {
  if (!v) return null;
  const p = v.split(':');
  if (p[0] === 'base') return makeStone(p[2] as Rarity, { type: 'base', stat: p[1] as StatKey, value: 0 });
  return makeStone(p[1] as Rarity, { type: p[0] } as Stone['kind']);
}
function stoneSelect(current: Stone | undefined, onChange: (s: Stone | null) => void) {
  const sel = h('select', { class: 'stone', onchange: () => onChange(parseStone(sel.value)) }, h('option', { value: '' }, '– leer –'));
  const grp = (label: string, opts: [string, string][]) =>
    h('optgroup', { label }, ...opts.map(([v, t]) => h('option', { value: v }, t)));
  for (const k of STAT_KEYS) {
    sel.append(
      grp(
        `Grundstein ${STAT_NAMES[k]}`,
        (['common', 'rare', 'epic', 'legendary'] as Rarity[]).map((r) => [`base:${k}:${r}`, `${STAT_NAMES[k]} +${cfg.stones.baseValue[r]} (${RARITY_NAMES[r]})`]),
      ),
    );
  }
  for (const t of ['krit', 'blutdurst'] as const) {
    sel.append(grp(SPECIAL_NAMES[t], (['epic', 'legendary', 'mythic'] as Rarity[]).map((r) => [`${t}:${r}`, `${SPECIAL_NAMES[t]} (${RARITY_NAMES[r]})`])));
  }
  sel.append(grp('Mythisch', (['zorn', 'dornen', 'erstschlag', 'fluch'] as const).map((t) => [`${t}:mythic`, `${SPECIAL_NAMES[t]} (Mythisch)`])));
  sel.value = stoneValue(current);
  return sel;
}

function selectOf<T extends string>(value: T, options: [T, string][], onChange: (v: T) => void) {
  const sel = h('select', { onchange: () => onChange(sel.value as T) }, ...options.map(([v, t]) => h('option', { value: v }, t)));
  sel.value = value;
  return sel;
}

function editor(side: 'a' | 'b'): HTMLElement {
  const g = () => state[side];
  const set = (ng: Gladiator, rebuild = false) => {
    state[side] = ng;
    persist();
    if (rebuild) $(`ed-${side}`).replaceWith(editor(side));
    refreshDuel();
  };
  const rarityPick = h(
    'select',
    { class: 'mini' },
    ...(['common', 'rare', 'epic', 'legendary'] as const).map((r) => h('option', { value: r }, RARITY_NAMES[r])),
  );
  rarityPick.value = g().rarity === 'mythic' ? 'legendary' : g().rarity;

  const statRows = STAT_KEYS.map((k) => {
    const range = h('input', { type: 'range', min: cfg.statMin, max: 10, step: 1, value: g().base[k] });
    const box = h('input', { type: 'number', min: cfg.statMin, max: cfg.statCap, step: 1, value: g().base[k], class: 'num' });
    const upd = (v: number) => {
      const val = Math.max(cfg.statMin, Math.min(cfg.statCap, Math.round(v) || cfg.statMin));
      range.value = String(val);
      box.value = String(val);
      set({ ...g(), base: { ...g().base, [k]: val } });
    };
    range.oninput = () => upd(Number(range.value));
    box.onchange = () => upd(Number(box.value));
    return h('div', { class: 'stat' }, h('label', {}, STAT_NAMES[k]), range, box, h('span', { class: 'eff', id: `eff-${side}-${k}` }));
  });

  const itemRows = g().items.map((it, idx) => {
    const upItem = (patch: Partial<typeof it>, rebuild = false) => {
      const items = g().items.map((x, i) => (i === idx ? { ...x, ...patch } : x));
      set({ ...g(), items }, rebuild);
    };
    const bonus = STAT_KEYS.map((k) => {
      const inp = h('input', {
        type: 'number',
        min: 0,
        max: 5,
        step: 1,
        value: it.bonus[k] ?? 0,
        class: 'num tiny',
        title: `${STAT_NAMES[k]}-Bonus`,
        onchange: () => upItem({ bonus: { ...g().items[idx].bonus, [k]: Math.max(0, Math.round(Number(inp.value)) || 0) } }),
      });
      return h('span', { class: 'bonus' }, h('small', {}, STAT_NAMES[k]), inp);
    });
    const sockets = selectOf(String(it.sockets) as '0' | '1' | '2', [['0', '0 Sockel'], ['1', '1 Sockel'], ['2', '2 Sockel']], (v) =>
      upItem({ sockets: Number(v), stones: g().items[idx].stones.slice(0, Number(v)) }, true),
    );
    const stones = Array.from({ length: it.sockets }, (_, si) =>
      stoneSelect(it.stones[si], (s) => {
        const st = [...g().items[idx].stones];
        if (s) st[si] = s;
        else st.splice(si, 1);
        upItem({ stones: st.filter(Boolean) }, true);
      }),
    );
    return h('div', { class: 'item' }, h('div', { class: 'slot' }, SLOT_NAMES[it.slot]), h('div', { class: 'bonuses' }, ...bonus), sockets, h('div', { class: 'stones' }, ...stones));
  });

  return h(
    'section',
    { class: `card glad ${side}`, id: `ed-${side}` },
    h(
      'div',
      { class: 'glad-head' },
      h('span', { class: 'side-tag' }, side.toUpperCase()),
      h('input', { class: 'name', value: g().name, onchange: (e: Event) => set({ ...g(), name: (e.target as HTMLInputElement).value }) }),
      selectOf(g().style, (Object.keys(STYLE_NAMES) as Style[]).map((st) => [st, STYLE_NAMES[st]] as [Style, string]), (v) => set({ ...g(), style: v })),
    ),
    h(
      'div',
      { class: 'row gap' },
      rarityPick,
      h(
        'button',
        {
          class: 'btn small',
          onclick: () => {
            const r = randomGladiator(mulberry32((Math.random() * 2 ** 32) >>> 0), cfg, rarityPick.value as Exclude<Rarity, 'mythic'>, g().style);
            set({ ...g(), rarity: r.rarity, base: r.base }, true);
          },
        },
        '🎲 Zufall',
      ),
      h(
        'button',
        { class: 'btn small ghost', onclick: () => set(withSlots({ ...g(), items: [] }), true) },
        'Ausrüstung leeren',
      ),
    ),
    h('h3', {}, 'Grundwerte'),
    ...statRows,
    h('h3', {}, 'Anweisungen'),
    h(
      'div',
      { class: 'orders' },
      h('label', {}, 'Haltung', selectOf(g().orders.stance, [['aggressiv', 'Aggressiv'], ['ausweichend', 'Ausweichend'], ['defensiv', 'Defensiv']], (v) => set({ ...g(), orders: { ...g().orders, stance: v } }))),
      h('label', {}, 'Distanz', selectOf(g().orders.distance, [['nah', 'Nah'], ['fern', 'Fern']], (v) => set({ ...g(), orders: { ...g().orders, distance: v } }))),
      h('label', {}, 'Letztes Gefecht', selectOf(g().orders.lastStand, [['normal', 'Normal'], ['alles', 'Alles geben'], ['durchhalten', 'Durchhalten']], (v) => set({ ...g(), orders: { ...g().orders, lastStand: v } }))),
    ),
    h('h3', {}, 'Ausrüstung und Steine'),
    ...itemRows,
    h('div', { class: 'summary', id: `sum-${side}` }),
  );
}

function refreshDuel() {
  for (const side of ['a', 'b'] as const) {
    const g = state[side];
    const eff = effectiveStats(g, cfg);
    for (const k of STAT_KEYS) {
      const el = document.getElementById(`eff-${side}-${k}`);
      if (el) {
        el.textContent = eff[k] !== g.base[k] ? `→ ${eff[k]}` : '';
        el.classList.toggle('capped', eff[k] >= cfg.statCap);
      }
    }
    const k = power(g, cfg);
    const cls = arenaClass(k, cfg);
    const sp = specialStones(g, cfg);
    const sum = document.getElementById(`sum-${side}`);
    if (sum) {
      sum.replaceChildren(
        h('div', { class: 'kbig' }, h('small', {}, 'Kraft K'), num(k, 2)),
        h('div', {}, h('span', { class: `cls ${cls.id}` }, cls.name), h('small', { class: 'muted' }, ` Einsatz ${money(cls.stake)}`)),
        h('div', { class: 'muted' }, `Effektiv ${STAT_KEYS.map((s) => `${STAT_NAMES[s]} ${eff[s]}`).join(' · ')}`),
        ...(sp.length ? [h('div', { class: 'muted' }, `Sonderstein: ${sp.map((s) => `${SPECIAL_NAMES[s.kind.type]} (${RARITY_NAMES[s.rarity]}) ×${num(cfg.kSurcharge[s.rarity] ?? 1, 2)} K`).join(', ')}`)] : []),
      );
    }
  }
  const kA = power(state.a, cfg);
  const kB = power(state.b, cfg);
  const f = document.getElementById('formula');
  if (f) {
    const p = formulaP(kA, kB, cfg.formulaExponent);
    f.replaceChildren(
      h('small', {}, `Formel (Exponent ${num(cfg.formulaExponent, 1)})`),
      h('div', { class: 'pbar' }, h('div', { class: 'pa', style: `width:${p * 100}%` }, pct(p)), h('div', { class: 'pb' }, pct(1 - p))),
      h('small', { class: 'muted' }, `K ${num(kA, 2)} gegen ${num(kB, 2)}`),
    );
  }
}

function renderDuel(view: HTMLElement) {
  const seedIn = h('input', { type: 'number', class: 'num wide', value: state.seed, onchange: () => { state.seed = Number(seedIn.value) >>> 0; persist(); } });
  const nIn = h('input', { type: 'number', class: 'num wide', value: state.n, min: 100, step: 1000, onchange: () => { state.n = Math.max(100, Number(nIn.value) | 0); persist(); } });

  const mid = h(
    'section',
    { class: 'card mid' },
    h('div', { id: 'formula', class: 'formula' }),
    h('h3', {}, 'Einzelkampf'),
    h(
      'div',
      { class: 'row gap' },
      h('label', { class: 'inline' }, 'Seed', seedIn),
      h('button', { class: 'btn small ghost', title: 'Neuer Seed', onclick: () => { seedIn.value = String((Math.random() * 1e9) | 0); seedIn.onchange?.(new Event('change')); } }, '🎲'),
    ),
    h('button', { class: 'btn big', onclick: () => singleFight() }, 'Kämpfen'),
    h('h3', {}, 'Massensimulation'),
    h('label', { class: 'inline' }, 'Kämpfe', nIn),
    h('button', { class: 'btn big gold', onclick: () => massFight() }, `Simulieren`),
    h('button', { class: 'btn', onclick: () => stoneWorth('a'), title: 'A mit Sondersteinen gegen A ohne Sondersteine' }, 'Steinwert von A messen'),
    h('h3', {}, 'Werkzeuge'),
    h(
      'div',
      { class: 'row gap wrap' },
      h('button', { class: 'btn small ghost', onclick: () => { [state.a, state.b] = [state.b, state.a]; persist(); render(); } }, '⇄ Tauschen'),
      h('button', { class: 'btn small ghost', onclick: () => { state.b = { ...structuredClone(state.a), id: state.b.id, name: state.a.name + ' II' }; persist(); render(); } }, 'A → B kopieren'),
    ),
  );

  view.replaceChildren(
    h('div', { class: 'duel' }, editor('a'), mid, editor('b')),
    h('div', { id: 'out', class: 'out' }),
  );
  refreshDuel();
}

function names(): [string, string] {
  return [state.a.name || 'A', state.b.name || 'B'];
}

function singleFight() {
  const r = simulate(state.a, state.b, state.seed, cfg, { events: true });
  const out = $('out');
  out.replaceChildren(fightPanel(r));
}

function fightPanel(r: FightResult): HTMLElement {
  const nm = names();
  const ev = r.events ?? [];
  const canvas = h('canvas', { class: 'chart', width: 900, height: 220 });
  const log = h('div', { class: 'log' });
  log.append(h('div', { class: 'ev muted' }, `Tagesform: ${nm[0]} ${pp(r.form[0] - 1).replace(' pp', ' %')}, ${nm[1]} ${pp(r.form[1] - 1).replace(' pp', ' %')}`));
  for (const e of ev) log.append(eventLine(e, nm));
  requestAnimationFrame(() => drawHp(canvas, ev, r.maxHp, r.seconds));
  return h(
    'section',
    { class: 'card result' },
    h('h2', {}, `${nm[r.winner]} gewinnt`, h('small', { class: 'muted' }, ` · ${r.events?.at(-1)?.type === 'end' && (r.events.at(-1) as { reason: string }).reason === 'zeit' ? 'nach Zeit' : 'K.o.'} nach ${num(r.seconds)} s · Seed ${state.seed}`)),
    h('div', { class: 'row gap muted' }, `HP übrig: ${nm[0]} ${Math.round(r.hpLeft[0])}/${r.maxHp[0]} · ${nm[1]} ${Math.round(r.hpLeft[1])}/${r.maxHp[1]} · Angriffe ${r.hits[0]} / ${r.hits[1]}`),
    canvas,
    log,
  );
}

function eventLine(e: FightEvent, nm: [string, string]): HTMLElement {
  const t = h('span', { class: 't' }, `${num(e.t)} s`);
  switch (e.type) {
    case 'hit':
      return h('div', { class: `ev side${e.from} ${e.crit ? 'crit' : ''} ${e.lucky ? 'lucky' : ''}` }, t, `${nm[e.from]} trifft: `, h('b', {}, e.dmg.toLocaleString('de-DE')), e.lucky ? ' WUCHTTREFFER' : '', e.crit ? ' KRIT' : '', h('span', { class: 'muted' }, ` · ${nm[1 - e.from]} ${Math.round(e.hpLeft)} HP`));
    case 'dodge':
      return h('div', { class: `ev side${1 - e.from} muted` }, t, `${nm[1 - e.from]} weicht aus`);
    case 'heal':
      return h('div', { class: `ev side${e.who} heal` }, t, `${nm[e.who]} heilt sich um ${e.amount} (Blutdurst)`);
    case 'thorns':
      return h('div', { class: `ev side${1 - e.who}` }, t, `Dornen: ${nm[e.who]} erleidet ${e.dmg}`);
    case 'laststand':
      return h('div', { class: `ev side${e.who} ls` }, t, `${nm[e.who]}: Letztes Gefecht!`);
    case 'end':
      return h('div', { class: 'ev end' }, t, `Ende: ${nm[e.winner]} gewinnt (${e.reason === 'ko' ? 'K.o.' : 'Zeit'})`);
  }
}

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function drawHp(c: HTMLCanvasElement, ev: FightEvent[], maxHp: [number, number], secs: number) {
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth || 900;
  const hgt = c.clientHeight || 220;
  c.width = w * dpr;
  c.height = hgt * dpr;
  const x = c.getContext('2d')!;
  x.scale(dpr, dpr);
  const pad = { l: 40, r: 10, t: 10, b: 22 };
  const T = Math.max(1, secs);
  const px = (t: number) => pad.l + (t / T) * (w - pad.l - pad.r);
  const py = (f: number) => pad.t + (1 - f) * (hgt - pad.t - pad.b);
  x.strokeStyle = cssVar('--line');
  x.fillStyle = cssVar('--muted');
  x.font = '11px Inter, sans-serif';
  x.lineWidth = 1;
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    x.beginPath();
    x.moveTo(pad.l, py(f));
    x.lineTo(w - pad.r, py(f));
    x.stroke();
    x.fillText(`${f * 100} %`, 4, py(f) + 4);
  }
  for (let s = 0; s <= T; s += T > 30 ? 10 : 5) x.fillText(`${s} s`, px(s) - 8, hgt - 6);
  const series: [number, number][][] = [[[0, 1]], [[0, 1]]];
  const marks: { t: number; f: number; who: number; kind: string }[] = [];
  for (const e of ev) {
    if (e.type === 'hit') {
      const who = 1 - e.from;
      series[who].push([e.t, e.hpLeft / maxHp[who]]);
      if (e.crit || e.lucky) marks.push({ t: e.t, f: e.hpLeft / maxHp[who], who, kind: e.lucky ? 'lucky' : 'crit' });
    } else if (e.type === 'heal' || e.type === 'thorns') {
      series[e.who].push([e.t, e.hpLeft / maxHp[e.who]]);
    }
  }
  const colors = [cssVar('--a'), cssVar('--b')];
  series.forEach((pts, i) => {
    x.strokeStyle = colors[i];
    x.lineWidth = 2.5;
    x.beginPath();
    pts.forEach(([t, f], j) => {
      if (j === 0) x.moveTo(px(t), py(f));
      else {
        x.lineTo(px(t), py(pts[j - 1][1]));
        x.lineTo(px(t), py(f));
      }
    });
    x.lineTo(px(T), py(pts[pts.length - 1][1]));
    x.stroke();
  });
  for (const m of marks) {
    x.fillStyle = m.kind === 'lucky' ? cssVar('--gold') : colors[1 - m.who];
    x.beginPath();
    x.arc(px(m.t), py(m.f), m.kind === 'lucky' ? 5 : 3.5, 0, Math.PI * 2);
    x.fill();
  }
}

async function massFight() {
  const out = $('out');
  out.replaceChildren(h('section', { class: 'card result' }, h('h2', {}, `${state.n.toLocaleString('de-DE')} Kämpfe laufen …`)));
  try {
    const { result: m, ms } = await runJob<MassResult>({ type: 'mass', a: state.a, b: state.b, n: state.n, seed: state.seed, cfg }, setProgress);
    const nm = names();
    const kA = power(state.a, cfg);
    const kB = power(state.b, cfg);
    const f = formulaP(kA, kB, cfg.formulaExponent);
    const dev = m.p - f;
    out.replaceChildren(
      h(
        'section',
        { class: 'card result' },
        h('h2', {}, `${nm[0]} gewinnt ${pct(m.p)}`, h('small', { class: 'muted' }, ` ± ${num(m.ci95 * 100)} pp (95 %)`)),
        h(
          'div',
          { class: 'stats-grid' },
          tile('Formel sagt', pct(f)),
          tile('Abweichung', pp(dev), Math.abs(dev) <= 0.03 ? 'good' : 'bad'),
          tile('Passender K-Faktor', `×${num(kFactorFromP(m.p, cfg.formulaExponent) / (kA / kB), 3)}`, '', 'Wie viel stärker A wirklich ist, als K sagt'),
          tile('Ø Kampfdauer', `${num(m.avgSeconds)} s`),
          tile('Ø Angriffe', num(m.avgHits, 1)),
          tile('Zeitablauf', `${m.timeouts}`),
          tile('Rechenzeit', `${num(ms / 1000, 2)} s`, ms < 10000 ? 'good' : 'bad'),
        ),
        h('p', { class: 'muted' }, `Seiten wechseln sich ab. Seed ${state.seed}. Gleicher Seed ergibt immer dasselbe Ergebnis.`),
      ),
    );
  } catch (e) {
    out.replaceChildren(h('section', { class: 'card result' }, h('h2', {}, `Abgebrochen`), h('p', { class: 'muted' }, String((e as Error).message))));
  }
}

async function stoneWorth(side: 'a' | 'b') {
  const g = state[side];
  const sp = specialStones(g, cfg);
  const out = $('out');
  if (!sp.length) {
    out.replaceChildren(h('section', { class: 'card result' }, h('h2', {}, 'Kein Sonderstein'), h('p', { class: 'muted' }, 'Setze zuerst einen Sonderstein in einen Sockel.')));
    return;
  }
  const without: Gladiator = {
    ...g,
    id: g.id + 'x',
    items: g.items.map((it) => ({ ...it, stones: it.stones.slice(0, it.sockets).filter((s) => s.kind.type === 'base') , sockets: it.sockets })),
  };
  out.replaceChildren(h('section', { class: 'card result' }, h('h2', {}, 'Steinwert wird gemessen …')));
  try {
    const { result: m } = await runJob<MassResult>({ type: 'mass', a: g, b: without, n: state.n, seed: state.seed, cfg }, setProgress);
    const kf = kFactorFromP(m.p, cfg.formulaExponent);
    const set = sp.reduce((s, x) => s * (cfg.kSurcharge[x.rarity] ?? 1), 1);
    out.replaceChildren(
      h(
        'section',
        { class: 'card result' },
        h('h2', {}, `${sp.map((s) => SPECIAL_NAMES[s.kind.type]).join(', ')}: ${pct(m.p)} gegen sich selbst ohne Stein`),
        h(
          'div',
          { class: 'stats-grid' },
          tile('Plus', pp(m.p - 0.5)),
          tile('Gemessener K-Faktor', `×${num(kf, 3)}`),
          tile('Eingestellt', `×${num(set, 3)}`, Math.abs(kf - set) <= cfg.stoneTolerance ? 'good' : 'bad'),
        ),
        h('p', { class: 'muted' }, `${m.n.toLocaleString('de-DE')} Kämpfe. Der Wert hängt etwas von den Stats ab. Für die Gesamtübersicht gibt es die Analyse „Steine“.`),
      ),
    );
  } catch {
    out.replaceChildren();
  }
}

function tile(label: string, value: string, cls = '', title = '') {
  return h('div', { class: `tile ${cls}`, title }, h('small', {}, label), h('b', {}, value));
}

// ---------- Analysen ----------

const ANALYSES: { id: AnalysisId; title: string; text: string }[] = [
  { id: 'formel', title: 'Formel', text: 'Passt P = Kᵉ/(Kᵉ+Kᵉ) zur Simulation? 240 zufällige Paare.' },
  { id: 'haltung', title: 'Haltung', text: 'Wie viel bringt ein Konter bei gleicher Kraft? Ziel +5 bis +8 pp.' },
  { id: 'steine', title: 'Steine', text: 'Jeder Stein mit und ohne, umgerechnet in einen K-Faktor.' },
  { id: 'steinstufen', title: 'Steine je Stärke', text: 'Ist ein Stein bei schwachen und starken Gladiatoren gleich viel wert?' },
  { id: 'gefecht', title: 'Letztes Gefecht', text: 'Alles geben, Durchhalten oder Normal: keine Wahl soll klar besser sein.' },
  { id: 'distanz', title: 'Distanz', text: 'Was bringt die passende Distanz zum Kampfstil?' },
  { id: 'klassen', title: 'Klassenränder', text: 'Stärkster gegen Schwächsten jeder Arena-Klasse.' },
  { id: 'stile', title: 'Kampfstile', text: 'Schwer, Flink und Speer bei gleicher Kraft.' },
];
const reports = new Map<AnalysisId, { r: Report; ms: number }>();

function renderAnalyses(view: HTMLElement) {
  const nIn = h('input', { type: 'number', class: 'num wide', value: state.anaN, min: 500, step: 1000, onchange: () => { state.anaN = Math.max(500, Number(nIn.value) | 0); persist(); } });
  const sIn = h('input', { type: 'number', class: 'num wide', value: state.anaSeed, onchange: () => { state.anaSeed = Number(sIn.value) >>> 0; persist(); } });
  const list = h('div', { id: 'reports' });
  view.replaceChildren(
    h(
      'section',
      { class: 'card' },
      h('div', { class: 'row gap wrap' }, h('label', { class: 'inline' }, 'Kämpfe pro Test', nIn), h('label', { class: 'inline' }, 'Seed', sIn), h('button', { class: 'btn big gold', onclick: () => runAll() }, 'Alle ausführen')),
      h(
        'div',
        { class: 'ana-grid' },
        ...ANALYSES.map((a) =>
          h('button', { class: 'ana', onclick: () => runOne(a.id) }, h('b', {}, a.title), h('small', {}, a.text), h('span', { class: 'badge', id: `badge-${a.id}` })),
        ),
      ),
    ),
    list,
  );
  for (const a of ANALYSES) if (reports.has(a.id)) showReport(a.id);
}

async function runOne(id: AnalysisId) {
  try {
    const { result, ms } = await runJob<Report>({ type: 'analysis', id, n: state.anaN, seed: state.anaSeed, cfg }, setProgress);
    reports.set(id, { r: result, ms });
    if (state.tab === 'analysen') showReport(id);
  } catch {
    /* abgebrochen */
  }
}

async function runAll() {
  for (const a of ANALYSES) {
    await runOne(a.id);
    if (!document.body.classList.contains('busy') && !reports.has(a.id)) break;
  }
}

function showReport(id: AnalysisId) {
  const entry = reports.get(id);
  if (!entry) return;
  const { r, ms } = entry;
  const badge = document.getElementById(`badge-${id}`);
  if (badge) {
    badge.textContent = r.ok ? 'OK' : 'prüfen';
    badge.className = `badge ${r.ok ? 'good' : 'bad'}`;
  }
  const card = h(
    'section',
    { class: 'card report', id: `rep-${id}` },
    h('h2', {}, r.title, h('span', { class: `badge ${r.ok ? 'good' : 'bad'}` }, r.ok ? 'OK' : 'prüfen'), h('small', { class: 'muted' }, ` ${num(ms / 1000, 1)} s`)),
    ...r.summary.map((s) => h('p', {}, s.replace(/(\d)\.(\d)/g, '$1,$2'))),
    h(
      'div',
      { class: 'table-wrap' },
      h('table', {}, h('thead', {}, h('tr', {}, ...r.head.map((c) => h('th', {}, c)))), h('tbody', {}, ...r.rows.map((row) => h('tr', {}, ...row.map((c) => h('td', { class: cellClass(String(c)) }, String(c).replace(/(\d)\.(\d)/g, '$1,$2'))))))),
    ),
  );
  if (r.points) {
    const c = h('canvas', { class: 'chart square', width: 420, height: 420 });
    card.append(h('p', { class: 'muted' }, 'Jeder Punkt ist ein Paar: waagerecht die Formel, senkrecht die Messung. Auf der Diagonale passt es genau.'), c);
    requestAnimationFrame(() => drawScatter(c, r.points!));
  }
  if (id === 'steine') {
    card.append(h('button', { class: 'btn', onclick: () => adoptStoneFactors(r) }, 'Gemessene Faktoren als Aufschlag übernehmen'));
  }
  const old = document.getElementById(`rep-${id}`);
  if (old) old.replaceWith(card);
  else {
    const list = document.getElementById('reports');
    if (!list) return;
    // Reihenfolge wie in der Liste oben
    const order = ANALYSES.map((a) => a.id);
    const after = [...list.children].find((el) => order.indexOf(el.id.slice(4) as AnalysisId) > order.indexOf(id));
    list.insertBefore(card, after ?? null);
  }
}

function cellClass(c: string) {
  if (c === 'ok' || c === 'passt' || c === 'Konter') return 'good';
  if (c.startsWith('zu ') || c.startsWith('im Schnitt') || c === 'wird gekontert') return 'bad';
  return '';
}

function adoptStoneFactors(r: Report) {
  // Mittel der gemessenen Faktoren aller Sondersteine pro Seltenheit
  const byR = new Map<Rarity, number[]>();
  for (const row of r.rows) {
    if (row[6] === 'Stat-Stein') continue;
    const rar = RARITIES.find((x) => RARITY_NAMES[x] === row[1]);
    const kf = Number(String(row[4]).replace('×', ''));
    if (rar && kf) byR.set(rar, [...(byR.get(rar) ?? []), kf]);
  }
  for (const [rar, list] of byR) cfg.kSurcharge[rar] = Math.round((list.reduce((s, v) => s + v, 0) / list.length) * 1000) / 1000;
  saveConfig(cfg);
  alertBox(`Übernommen: ${[...byR.keys()].map((k) => `${RARITY_NAMES[k]} ×${cfg.kSurcharge[k]}`).join(', ')}`);
}

function alertBox(text: string) {
  const t = h('div', { class: 'toast' }, text);
  document.body.append(t);
  setTimeout(() => t.remove(), 3500);
}

function drawScatter(c: HTMLCanvasElement, pts: { x: number; y: number }[]) {
  const dpr = window.devicePixelRatio || 1;
  const s = Math.min(420, c.parentElement?.clientWidth ?? 420);
  c.style.width = `${s}px`;
  c.style.height = `${s}px`;
  c.width = s * dpr;
  c.height = s * dpr;
  const x = c.getContext('2d')!;
  x.scale(dpr, dpr);
  const pad = 36;
  const m = (v: number) => pad + ((v - 0.5) / 0.5) * (s - pad - 10);
  const my = (v: number) => s - pad - ((v - 0.5) / 0.5) * (s - pad - 10);
  x.strokeStyle = cssVar('--line');
  x.fillStyle = cssVar('--muted');
  x.font = '11px Inter, sans-serif';
  for (const v of [0.5, 0.6, 0.7, 0.8, 0.9, 1]) {
    x.beginPath();
    x.moveTo(m(v), my(0.5));
    x.lineTo(m(v), my(1));
    x.moveTo(m(0.5), my(v));
    x.lineTo(m(1), my(v));
    x.stroke();
    x.fillText(`${Math.round(v * 100)}`, m(v) - 8, s - pad + 16);
    x.fillText(`${Math.round(v * 100)}`, 6, my(v) + 4);
  }
  x.strokeStyle = cssVar('--gold');
  x.lineWidth = 1.5;
  x.beginPath();
  x.moveTo(m(0.5), my(0.5));
  x.lineTo(m(1), my(1));
  x.stroke();
  x.fillStyle = cssVar('--a');
  for (const p of pts) {
    x.beginPath();
    x.arc(m(p.x), my(Math.max(0.45, p.y)), 3, 0, Math.PI * 2);
    x.fill();
  }
}

// ---------- Einstellungen ----------

function renderConfig(view: HTMLElement) {
  const apply = (next: Config, rerender = true) => {
    cfg = next;
    saveConfig(cfg);
    if (rerender) renderConfig(view);
  };
  const numIn = (value: number, onSet: (v: number) => void, step = 0.01) => {
    const inp = h('input', { type: 'number', class: 'num wide', value, step, onchange: () => { const v = Number(inp.value); if (Number.isFinite(v)) onSet(v); } });
    return inp;
  };

  const classRows = cfg.arena.classes.map((c, i) =>
    h(
      'tr',
      {},
      h('td', {}, h('input', { class: 'text', value: c.name, onchange: (e: Event) => { cfg.arena.classes[i].name = (e.target as HTMLInputElement).value; apply(cfg, false); } })),
      h('td', {}, numIn(c.minK, (v) => { cfg.arena.classes[i].minK = v; if (i > 0) cfg.arena.classes[i - 1].maxK = v; apply(cfg); }, 0.5)),
      h('td', {}, numIn(c.maxK, (v) => { cfg.arena.classes[i].maxK = v; if (i < cfg.arena.classes.length - 1) cfg.arena.classes[i + 1].minK = v; apply(cfg); }, 0.5)),
      h('td', {}, numIn(c.stake, (v) => { cfg.arena.classes[i].stake = Math.round(v); apply(cfg); }, 10), h('small', { class: 'muted' }, ` ${money(c.stake)}`)),
      h('td', {}, selectOf(c.stoneRarity, RARITIES.map((r) => [r, RARITY_NAMES[r]] as [Rarity, string]), (v) => { cfg.arena.classes[i].stoneRarity = v; apply(cfg, false); })),
    ),
  );

  const json = h('textarea', { class: 'json', spellcheck: false, value: JSON.stringify(cfg, null, 2) });
  const diff = changedPaths(DEFAULT_CONFIG, cfg);

  view.replaceChildren(
    h(
      'div',
      { class: 'cfg-grid' },
      h(
        'section',
        { class: 'card' },
        h('h2', {}, 'Arena-Klassen'),
        h('p', { class: 'muted' }, 'Nach Kraft K inklusive Ausrüstung und Steinen. Eine Grenze zu ändern verschiebt auch die Nachbarklasse. Einsätze in Silber (100 Silber = 1 Gold).'),
        h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ...['Klasse', 'ab K', 'bis K', 'Einsatz (Silber)', 'Stein-Belohnung'].map((t) => h('th', {}, t)))), h('tbody', {}, ...classRows))),
        h('label', { class: 'inline' }, 'Arena-Anteil', numIn(cfg.arena.arenaShare, (v) => { cfg.arena.arenaShare = v; apply(cfg, false); })),
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', {}, 'Formel und Steine'),
        h('label', { class: 'inline' }, 'Formel-Exponent', numIn(cfg.formulaExponent, (v) => { cfg.formulaExponent = v; apply(cfg, false); }, 0.1)),
        h('p', { class: 'muted' }, 'Kraft-Aufschlag pro Sonderstein (Faktor auf K):'),
        ...(['epic', 'legendary', 'mythic'] as Rarity[]).map((r) => h('label', { class: 'inline' }, RARITY_NAMES[r], numIn(cfg.kSurcharge[r] ?? 1, (v) => { cfg.kSurcharge[r] = v; apply(cfg, false); }, 0.01))),
        h('label', { class: 'inline' }, 'Erlaubte Abweichung', numIn(cfg.stoneTolerance, (v) => { cfg.stoneTolerance = v; apply(cfg, false); })),
        h('label', { class: 'inline' }, 'Höchste Stat', numIn(cfg.statCap, (v) => { cfg.statCap = Math.round(v); apply(cfg, false); }, 1)),
      ),
      h(
        'section',
        { class: 'card wide' },
        h('h2', {}, 'Alle Werte'),
        h('p', { class: 'muted' }, diff.length ? `Geändert gegenüber Standard: ${diff.join(', ')}` : 'Alles auf Standardwerten.'),
        json,
        h(
          'div',
          { class: 'row gap wrap' },
          h('button', { class: 'btn gold', onclick: () => { try { apply(mergeConfig(structuredClone(DEFAULT_CONFIG), JSON.parse(json.value)) as Config); alertBox('Übernommen und gespeichert'); } catch (e) { alertBox(`Fehler im JSON: ${(e as Error).message}`); } } }, 'Übernehmen'),
          h('button', { class: 'btn', onclick: () => download('arenagame-config.json', JSON.stringify(cfg, null, 2)) }, 'Exportieren'),
          h('button', { class: 'btn', onclick: () => importFile((txt) => { try { apply(mergeConfig(structuredClone(DEFAULT_CONFIG), JSON.parse(txt)) as Config); alertBox('Importiert'); } catch { alertBox('Datei ist kein gültiges JSON'); } }) }, 'Importieren'),
          h('button', { class: 'btn danger', onclick: () => { apply(structuredClone(DEFAULT_CONFIG)); alertBox('Auf Standard zurückgesetzt'); } }, 'Zurücksetzen'),
        ),
      ),
    ),
  );
}

function changedPaths(a: unknown, b: unknown, path = ''): string[] {
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a)) {
    return Object.keys(b as object).flatMap((k) => changedPaths((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k));
  }
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [path];
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function importFile(onText: (t: string) => void) {
  const inp = h('input', { type: 'file', accept: '.json,application/json' });
  inp.onchange = async () => {
    const f = inp.files?.[0];
    if (f) onText(await f.text());
  };
  inp.click();
}

render();
