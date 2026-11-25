// Das Test-Tool: Gladiatoren bauen, einzeln und massenhaft kämpfen lassen, Balance-Analysen, alle Zahlen einstellen.

import './style.css';
import { h } from './dom';
// inline: der Worker steckt mit in der Datei, damit das Test-Tool auch als einzelne HTML-Datei läuft
import ArenaWorker from './worker?worker&inline';
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
import type { MercyChoice } from '../sim/names';
import type { Distance, FightEvent, FightResult, Gladiator, LastStand, Rarity, Slot, Stance, StatKey, Stone, Style } from '../sim/types';
import { formatMoney, DISTANCE_NAMES, LAST_STAND_NAMES, SLOT_NAMES, STANCE_NAMES, STAT_NAMES, STONE_NAMES, STYLE_NAMES } from '../sim/names';
import { renderArena, playArena, setMailReplay, stopArena } from './arenaTab';
import { autoChoice, postFight } from '../sim/game';
import { badgeCount, changed as gameChanged, gs, initGame, on as onGame } from './gameCtl';
import { renderIsland, stopIsland } from './islandTab';
import { renderInventory } from './inventoryTab';
import { focusUnread, renderMail, selectMail, stopMail } from './mailTab';
import { toast } from './lootUi';
import { setMuted, sfx, unlockAudio } from '../render/audio';
import { loadConfig, loadState, mergeConfig, saveConfig, saveState } from './store';
import type { WorkerRequest } from './worker';

// ---------- kleine Helfer ----------

const $ = (id: string) => document.getElementById(id)!;
const num = (v: number, d = 1) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v: number, d = 1) => `${num(v * 100, d)} %`;
const pp = (v: number) => `${v >= 0 ? '+' : '−'}${num(Math.abs(v * 100))} pp`;
const money = formatMoney;

const SLOTS: Slot[] = ['weapon', 'armor', 'amulet'];
const RARITIES: Rarity[] = ['common', 'rare', 'epic', 'legendary', 'mythic'];
const SPECIAL_NAMES = STONE_NAMES;

// ---------- Zustand ----------

interface State {
  tab: 'island' | 'inventory' | 'mail' | 'duel' | 'arena' | 'analyses' | 'config';
  a: Gladiator;
  b: Gladiator;
  seed: number;
  n: number;
  anaN: number;
  anaSeed: number;
  speed: number;
  blood: boolean;
  sound: boolean;
}

let cfg: Config = loadConfig();

function withSlots(g: Gladiator): Gladiator {
  const items = SLOTS.map((s) => g.items.find((it) => it.slot === s) ?? makeItem(s, 'common', {}, 0, []));
  return { ...g, items };
}

const saved = loadState<State>();
const state: State = {
  tab: (saved?.tab as State['tab'] | undefined) && ['island', 'inventory', 'mail', 'duel', 'arena', 'analyses', 'config'].includes(saved!.tab) ? saved!.tab : 'island',
  a: withSlots(saved?.a ?? makeGladiator({ name: 'Brutus', style: 'heavy', base: { atk: 7, def: 6, hp: 7, spd: 4 } })),
  b: withSlots(saved?.b ?? makeGladiator({ name: 'Velox', style: 'swift', base: { atk: 5, def: 5, hp: 6, spd: 9 } })),
  seed: saved?.seed ?? 1,
  n: saved?.n ?? 10000,
  anaN: saved?.anaN ?? 10000,
  anaSeed: saved?.anaSeed ?? 1,
  speed: saved?.speed ?? 1,
  blood: saved?.blood ?? true,
  sound: saved?.sound ?? true,
};
setMuted(!state.sound);
const persist = () => saveState(state);
initGame(() => cfg);

function gotoTab(tab: State['tab']) {
  state.tab = tab;
  persist();
  render();
}

const arena = {
  get state() {
    return state;
  },
  get cfg() {
    return cfg;
  },
  persist,
  onFightDone(a: Gladiator, b: Gladiator, seed: number, choice: MercyChoice, at: number) {
    postFight(gs(), a, b, seed, cfg, choice, at, { watched: true });
    gameChanged();
    sfx.mail();
  },
  fightUnseen(n: number) {
    unlockAudio();
    for (let i = 0; i < n; i++) {
      const seed = (Math.random() * 2 ** 32) >>> 0;
      postFight(gs(), state.a, state.b, seed, cfg, autoChoice(state.a, state.b, seed, cfg));
    }
    gameChanged();
    sfx.mail();
    toast(n === 1 ? 'Fight finished · check your mailbox' : `${n} fights finished · check your mailbox`);
  },
  backToMail(mailId: number) {
    setMailReplay(null);
    selectMail(mailId);
    gotoTab('mail');
  },
};

// ---------- Worker ----------

let worker: Worker | null = null;
let jobId = 0;
let pending: { id: number; resolve: (v: { result: unknown; ms: number }) => void; reject: (e: Error) => void; onProgress?: (d: number, t: number) => void } | null = null;

function getWorker(): Worker {
  if (worker) return worker;
  worker = new ArenaWorker();
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
    pending.reject(new Error('cancelled'));
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
      h('div', { class: 'brand' }, h('span', { class: 'logo' }, '⚔'), h('div', {}, h('h1', {}, 'Arena'), h('small', {}, 'Test Tool · Milestone 3'))),
      h(
        'nav',
        { class: 'tabs' },
        ...(
          [
            ['island', 'Island'],
            ['inventory', 'Inventory'],
            ['mail', 'Mailbox'],
            ['duel', 'Duel'],
            ['arena', 'Arena'],
            ['analyses', 'Analyses'],
            ['config', 'Settings'],
          ] as const
        ).map(([id, label]) =>
          h(
            'button',
            {
              id: `tab-${id}`,
              class: `tab ${state.tab === id ? 'on' : ''} ${id === 'duel' ? 'tab-gap' : ''}`,
              onclick: () => {
                sfx.click();
                if (id === 'arena') setMailReplay(null);
                if (id === 'mail') focusUnread();
                gotoTab(id);
              },
            },
            label,
            id === 'mail' ? h('span', { id: 'mail-badge', class: 'badge-red hidden' }) : null,
          ),
        ),
      ),
      h('div', { id: 'wallet', class: 'wallet-chip', title: 'Your gold' }),
      h('button', { class: 'btn ghost cancel', onclick: cancelJob, title: 'Cancel the running job' }, 'Cancel'),
    ),
    h('div', { class: 'progress' }, h('div', { id: 'progress' })),
    h('main', { id: 'view' }),
  );
  const view = $('view');
  if (state.tab !== 'arena') {
    stopArena();
    setMailReplay(null);
  }
  stopIsland();
  stopMail();
  refreshHeader();
  if (state.tab === 'island') renderIsland(view, { cfg: () => cfg, goto: gotoTab });
  else if (state.tab === 'inventory') renderInventory(view, { cfg: () => cfg, gladiators: () => [state.a, state.b], goto: gotoTab });
  else if (state.tab === 'mail') renderMail(view, { cfg: () => cfg, replay: (f, id) => { setMailReplay(f, id); state.tab = 'arena'; persist(); render(); } });
  else if (state.tab === 'duel') renderDuel(view);
  else if (state.tab === 'arena') renderArena(view, arena);
  else if (state.tab === 'analyses') renderAnalyses(view);
  else renderConfig(view);
}

/** Geld und rote Zahl am Postfach ohne die ganze Seite neu zu bauen. */
let lastBadge = -1;
function refreshHeader() {
  const g = gs();
  const badge = document.getElementById('mail-badge');
  const n = badgeCount();
  if (badge) {
    badge.textContent = String(n);
    badge.classList.toggle('hidden', n === 0);
    if (n > lastBadge && lastBadge >= 0) {
      badge.classList.remove('pulse');
      void badge.offsetWidth;
      badge.classList.add('pulse');
    }
  }
  lastBadge = n;
  const w = document.getElementById('wallet');
  if (w) {
    w.textContent = `● ${money(g.silver)}`;
    w.classList.toggle('neg', g.silver < 0);
  }
}
onGame({ change: refreshHeader });

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
  const sel = h('select', { class: 'stone', onchange: () => onChange(parseStone(sel.value)) }, h('option', { value: '' }, '– empty –'));
  const grp = (label: string, opts: [string, string][]) =>
    h('optgroup', { label }, ...opts.map(([v, t]) => h('option', { value: v }, t)));
  for (const k of STAT_KEYS) {
    sel.append(
      grp(
        `Base Stone ${STAT_NAMES[k]}`,
        (['common', 'rare', 'epic', 'legendary'] as Rarity[]).map((r) => [`base:${k}:${r}`, `${STAT_NAMES[k]} +${cfg.stones.baseValue[r]} (${RARITY_NAMES[r]})`]),
      ),
    );
  }
  for (const t of ['crit', 'bloodthirst'] as const) {
    sel.append(grp(SPECIAL_NAMES[t], (['epic', 'legendary', 'mythic'] as Rarity[]).map((r) => [`${t}:${r}`, `${SPECIAL_NAMES[t]} (${RARITY_NAMES[r]})`])));
  }
  sel.append(grp('Mythic', (['wrath', 'thorns', 'firstStrike', 'curse'] as const).map((t) => [`${t}:mythic`, `${SPECIAL_NAMES[t]} (Mythic)`])));
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
    const sockets = selectOf(String(it.sockets) as '0' | '1' | '2', [['0', '0 sockets'], ['1', '1 socket'], ['2', '2 sockets']], (v) =>
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
        '🎲 Random',
      ),
      h(
        'button',
        { class: 'btn small ghost', onclick: () => set(withSlots({ ...g(), items: [] }), true) },
        'Clear gear',
      ),
    ),
    h('h3', {}, 'Base stats'),
    ...statRows,
    h('h3', {}, 'Orders'),
    h(
      'div',
      { class: 'orders' },
      h('label', {}, 'Stance', selectOf(g().orders.stance, (Object.keys(STANCE_NAMES) as Stance[]).map((k) => [k, STANCE_NAMES[k]] as [Stance, string]), (v) => set({ ...g(), orders: { ...g().orders, stance: v } }))),
      h('label', {}, 'Distance', selectOf(g().orders.distance, (Object.keys(DISTANCE_NAMES) as Distance[]).map((k) => [k, DISTANCE_NAMES[k]] as [Distance, string]), (v) => set({ ...g(), orders: { ...g().orders, distance: v } }))),
      h('label', {}, 'Last Stand', selectOf(g().orders.lastStand, (Object.keys(LAST_STAND_NAMES) as LastStand[]).map((k) => [k, LAST_STAND_NAMES[k]] as [LastStand, string]), (v) => set({ ...g(), orders: { ...g().orders, lastStand: v } }))),
    ),
    h('h3', {}, 'Gear and stones'),
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
        h('div', { class: 'kbig' }, h('small', {}, 'Power K'), num(k, 2)),
        h('div', {}, h('span', { class: `cls ${cls.id}` }, cls.name), h('small', { class: 'muted' }, ` Stake ${money(cls.stake)}`)),
        h('div', { class: 'muted' }, `Effective ${STAT_KEYS.map((s) => `${STAT_NAMES[s]} ${eff[s]}`).join(' · ')}`),
        ...(sp.length ? [h('div', { class: 'muted' }, `Special stone: ${sp.map((s) => `${SPECIAL_NAMES[s.kind.type]} (${RARITY_NAMES[s.rarity]}) ×${num(cfg.kSurcharge[s.rarity] ?? 1, 2)} K`).join(', ')}`)] : []),
      );
    }
  }
  const kA = power(state.a, cfg);
  const kB = power(state.b, cfg);
  const f = document.getElementById('formula');
  if (f) {
    const p = formulaP(kA, kB, cfg.formulaExponent);
    f.replaceChildren(
      h('small', {}, `Formula (exponent ${num(cfg.formulaExponent, 1)})`),
      h('div', { class: 'pbar' }, h('div', { class: 'pa', style: `width:${p * 100}%` }, pct(p)), h('div', { class: 'pb' }, pct(1 - p))),
      h('small', { class: 'muted' }, `K ${num(kA, 2)} vs ${num(kB, 2)}`),
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
    h('h3', {}, 'Single fight'),
    h(
      'div',
      { class: 'row gap' },
      h('label', { class: 'inline' }, 'Seed', seedIn),
      h('button', { class: 'btn small ghost', title: 'New seed', onclick: () => { seedIn.value = String((Math.random() * 1e9) | 0); seedIn.onchange?.(new Event('change')); } }, '🎲'),
    ),
    h('button', { class: 'btn big', onclick: () => singleFight() }, 'Fight'),
    h('button', { class: 'btn big gold', onclick: () => { unlockAudio(); state.tab = 'arena'; persist(); render(); playArena(arena); } }, 'Watch in Arena ▸'),
    h('h3', {}, 'Mass simulation'),
    h('label', { class: 'inline' }, 'Fights', nIn),
    h('button', { class: 'btn big gold', onclick: () => massFight() }, 'Simulate'),
    h('button', { class: 'btn', onclick: () => stoneWorth('a'), title: 'A with special stones vs A without them' }, 'Measure A\'s stone value'),
    h('h3', {}, 'Tools'),
    h(
      'div',
      { class: 'row gap wrap' },
      h('button', { class: 'btn small ghost', onclick: () => { [state.a, state.b] = [state.b, state.a]; persist(); render(); } }, '⇄ Swap'),
      h('button', { class: 'btn small ghost', onclick: () => { state.b = { ...structuredClone(state.a), id: state.b.id, name: state.a.name + ' II' }; persist(); render(); } }, 'Copy A → B'),
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
  log.append(h('div', { class: 'ev muted' }, `Form: ${nm[0]} ${pp(r.form[0] - 1).replace(' pp', ' %')}, ${nm[1]} ${pp(r.form[1] - 1).replace(' pp', ' %')}`));
  for (const e of ev) log.append(eventLine(e, nm));
  requestAnimationFrame(() => drawHp(canvas, ev, r.maxHp, r.seconds));
  return h(
    'section',
    { class: 'card result' },
    h('h2', {}, `${nm[r.winner]} wins`, h('small', { class: 'muted' }, ` · ${r.events?.at(-1)?.type === 'end' && (r.events.at(-1) as { reason: string }).reason === 'time' ? 'on time' : 'by KO'} after ${num(r.seconds)} s · seed ${state.seed}`)),
    h('div', { class: 'row gap muted' }, `HP left: ${nm[0]} ${Math.round(r.hpLeft[0])}/${r.maxHp[0]} · ${nm[1]} ${Math.round(r.hpLeft[1])}/${r.maxHp[1]} · attacks ${r.hits[0]} / ${r.hits[1]}`),
    canvas,
    log,
  );
}

function eventLine(e: FightEvent, nm: [string, string]): HTMLElement {
  const t = h('span', { class: 't' }, `${num(e.t)} s`);
  switch (e.type) {
    case 'hit':
      return h('div', { class: `ev side${e.from} ${e.crit ? 'crit' : ''} ${e.lucky ? 'lucky' : ''}` }, t, `${nm[e.from]} hits `, h('b', {}, e.dmg.toLocaleString('en-US')), e.lucky ? ' CRUSHING BLOW' : '', e.crit ? ' CRIT' : '', h('span', { class: 'muted' }, ` · ${nm[1 - e.from]} ${Math.round(e.hpLeft)} HP`));
    case 'dodge':
      return h('div', { class: `ev side${1 - e.from} muted` }, t, `${nm[1 - e.from]} dodges`);
    case 'heal':
      return h('div', { class: `ev side${e.who} heal` }, t, `${nm[e.who]} heals ${e.amount} (Bloodthirst)`);
    case 'thorns':
      return h('div', { class: `ev side${1 - e.who}` }, t, `Dornen: ${nm[e.who]} erleidet ${e.dmg}`);
    case 'laststand':
      return h('div', { class: `ev side${e.who} ls` }, t, `${nm[e.who]}: Last Stand!`);
    case 'end':
      return h('div', { class: 'ev end' }, t, `End: ${nm[e.winner]} wins (${e.reason === 'ko' ? 'KO' : 'time'})`);
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
  out.replaceChildren(h('section', { class: 'card result' }, h('h2', {}, `${state.n.toLocaleString('en-US')} fights running …`)));
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
        h('h2', {}, `${nm[0]} wins ${pct(m.p)}`, h('small', { class: 'muted' }, ` ± ${num(m.ci95 * 100)} pp (95 %)`)),
        h(
          'div',
          { class: 'stats-grid' },
          tile('Formula says', pct(f)),
          tile('Deviation', pp(dev), Math.abs(dev) <= 0.03 ? 'good' : 'bad'),
          tile('Fitted K factor', `×${num(kFactorFromP(m.p, cfg.formulaExponent) / (kA / kB), 3)}`, '', 'How much stronger A really is than K says'),
          tile('Avg fight length', `${num(m.avgSeconds)} s`),
          tile('Avg attacks', num(m.avgHits, 1)),
          tile('Timeouts', `${m.timeouts}`),
          tile('Compute time', `${num(ms / 1000, 2)} s`, ms < 10000 ? 'good' : 'bad'),
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
    out.replaceChildren(h('section', { class: 'card result' }, h('h2', {}, 'No special stone'), h('p', { class: 'muted' }, 'Put a special stone into a socket first.')));
    return;
  }
  const without: Gladiator = {
    ...g,
    id: g.id + 'x',
    items: g.items.map((it) => ({ ...it, stones: it.stones.slice(0, it.sockets).filter((s) => s.kind.type === 'base') , sockets: it.sockets })),
  };
  out.replaceChildren(h('section', { class: 'card result' }, h('h2', {}, 'Measuring stone value …')));
  try {
    const { result: m } = await runJob<MassResult>({ type: 'mass', a: g, b: without, n: state.n, seed: state.seed, cfg }, setProgress);
    const kf = kFactorFromP(m.p, cfg.formulaExponent);
    const set = sp.reduce((s, x) => s * (cfg.kSurcharge[x.rarity] ?? 1), 1);
    out.replaceChildren(
      h(
        'section',
        { class: 'card result' },
        h('h2', {}, `${sp.map((s) => SPECIAL_NAMES[s.kind.type]).join(', ')}: ${pct(m.p)} vs itself without the stone`),
        h(
          'div',
          { class: 'stats-grid' },
          tile('Gain', pp(m.p - 0.5)),
          tile('Measured K factor', `×${num(kf, 3)}`),
          tile('Configured', `×${num(set, 3)}`, Math.abs(kf - set) <= cfg.stoneTolerance ? 'good' : 'bad'),
        ),
        h('p', { class: 'muted' }, `${m.n.toLocaleString('en-US')} fights. The value depends a little on the stats. The Stones analysis gives the full picture.`),
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
  { id: 'formula', title: 'Formula', text: 'Does P = Kᵉ/(Kᵉ+Kᵉ) match the simulation? 240 random pairs.' },
  { id: 'stance', title: 'Stance', text: 'What is a counter worth at equal power? Target +5 to +8 pp.' },
  { id: 'stones', title: 'Stones', text: 'Every stone with and without, converted into a K factor.' },
  { id: 'stoneBuilds', title: 'Stones by build', text: 'Is a stone worth the same for glass cannons, tanks and the rest?' },
  { id: 'lastStand', title: 'Last Stand', text: 'All In, Hold Out or Normal: no choice should be clearly better.' },
  { id: 'distance', title: 'Distance', text: 'What is the preferred distance worth for each style?' },
  { id: 'classes', title: 'Class edges', text: 'Strongest vs weakest of each arena class.' },
  { id: 'styles', title: 'Styles', text: 'Heavy, Swift and Spear at equal power.' },
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
      h('div', { class: 'row gap wrap' }, h('label', { class: 'inline' }, 'Fights per test', nIn), h('label', { class: 'inline' }, 'Seed', sIn), h('button', { class: 'btn big gold', onclick: () => runAll() }, 'Run all')),
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
    if (state.tab === 'analyses') showReport(id);
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
    badge.textContent = r.ok ? 'OK' : 'check';
    badge.className = `badge ${r.ok ? 'good' : 'bad'}`;
  }
  const card = h(
    'section',
    { class: 'card report', id: `rep-${id}` },
    h('h2', {}, r.title, h('span', { class: `badge ${r.ok ? 'good' : 'bad'}` }, r.ok ? 'OK' : 'check'), h('small', { class: 'muted' }, ` ${num(ms / 1000, 1)} s`)),
    ...r.summary.map((s) => h('p', {}, s)),
    h(
      'div',
      { class: 'table-wrap' },
      h('table', {}, h('thead', {}, h('tr', {}, ...r.head.map((c) => h('th', {}, c)))), h('tbody', {}, ...r.rows.map((row) => h('tr', {}, ...row.map((c) => h('td', { class: cellClass(String(c)) }, String(c).replace(/(\d)\.(\d)/g, '$1,$2'))))))),
    ),
  );
  if (r.points) {
    const c = h('canvas', { class: 'chart square', width: 420, height: 420 });
    card.append(h('p', { class: 'muted' }, 'Each dot is a pair: across is the formula, up is the measurement. On the diagonal they match exactly.'), c);
    requestAnimationFrame(() => drawScatter(c, r.points!));
  }
  if (id === 'stones') {
    card.append(h('button', { class: 'btn', onclick: () => adoptStoneFactors(r) }, 'Adopt measured factors as bonus'));
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
  if (c === 'ok' || c === 'fits' || c === 'counters') return 'good';
  if (c.startsWith('too ') || c === 'is countered') return 'bad';
  return '';
}

function adoptStoneFactors(r: Report) {
  // Mittel der gemessenen Faktoren aller Sondersteine pro Seltenheit
  const byR = new Map<Rarity, number[]>();
  for (const row of r.rows) {
    if (row[6] === 'stat stone') continue;
    const rar = RARITIES.find((x) => RARITY_NAMES[x] === row[1]);
    const kf = Number(String(row[4]).replace('×', ''));
    if (rar && kf) byR.set(rar, [...(byR.get(rar) ?? []), kf]);
  }
  for (const [rar, list] of byR) cfg.kSurcharge[rar] = Math.round((list.reduce((s, v) => s + v, 0) / list.length) * 1000) / 1000;
  saveConfig(cfg);
  alertBox(`Adopted: ${[...byR.keys()].map((k) => `${RARITY_NAMES[k]} ×${cfg.kSurcharge[k]}`).join(', ')}`);
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
        h('h2', {}, 'Arena classes'),
        h('p', { class: 'muted' }, 'By power K including gear and stones. Moving an edge also moves the neighbouring class. Stakes in Silver (100 Silver = 1 Gold).'),
        h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ...['Class', 'From K', 'To K', 'Stake (Silver)', 'Stone reward'].map((t) => h('th', {}, t)))), h('tbody', {}, ...classRows))),
        h('label', { class: 'inline' }, 'Arena cut', numIn(cfg.arena.arenaShare, (v) => { cfg.arena.arenaShare = v; apply(cfg, false); })),
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', {}, 'Formula and stones'),
        h('label', { class: 'inline' }, 'Formula exponent', numIn(cfg.formulaExponent, (v) => { cfg.formulaExponent = v; apply(cfg, false); }, 0.1)),
        h('p', { class: 'muted' }, 'Power bonus per special stone (factor on K):'),
        ...(['epic', 'legendary', 'mythic'] as Rarity[]).map((r) => h('label', { class: 'inline' }, RARITY_NAMES[r], numIn(cfg.kSurcharge[r] ?? 1, (v) => { cfg.kSurcharge[r] = v; apply(cfg, false); }, 0.01))),
        h('label', { class: 'inline' }, 'Allowed deviation', numIn(cfg.stoneTolerance, (v) => { cfg.stoneTolerance = v; apply(cfg, false); })),
        h('label', { class: 'inline' }, 'Stat cap', numIn(cfg.statCap, (v) => { cfg.statCap = Math.round(v); apply(cfg, false); }, 1)),
      ),
      h(
        'section',
        { class: 'card wide' },
        h('h2', {}, 'All values'),
        h('p', { class: 'muted' }, diff.length ? `Changed from default: ${diff.join(', ')}` : 'Everything at default values.'),
        json,
        h(
          'div',
          { class: 'row gap wrap' },
          h('button', { class: 'btn gold', onclick: () => { try { apply(mergeConfig(structuredClone(DEFAULT_CONFIG), JSON.parse(json.value)) as Config); alertBox('Applied and saved'); } catch (e) { alertBox(`JSON error: ${(e as Error).message}`); } } }, 'Apply'),
          h('button', { class: 'btn', onclick: () => download('arenagame-config.json', JSON.stringify(cfg, null, 2)) }, 'Export'),
          h('button', { class: 'btn', onclick: () => importFile((txt) => { try { apply(mergeConfig(structuredClone(DEFAULT_CONFIG), JSON.parse(txt)) as Config); alertBox('Imported'); } catch { alertBox('File is not valid JSON'); } }) }, 'Import'),
          h('button', { class: 'btn danger', onclick: () => { apply(structuredClone(DEFAULT_CONFIG)); alertBox('Reset to defaults'); } }, 'Reset'),
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
