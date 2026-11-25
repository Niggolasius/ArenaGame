// Tab „Arena“ im Test-Tool: den Kampf der beiden Gladiatoren aus dem Duell-Tab als Pixel-Kampf ansehen,
// inklusive Mercy-Moment. Dazu Tempo, Zeitraffer, Blut an/aus, Ton und die Sprite-Sheets als Vorlage.

import type { Config } from '../sim/config';
import type { MercyChoice } from '../sim/names';
import { STYLE_NAMES } from '../sim/names';
import { arenaClass, power } from '../sim/stats';
import type { Gladiator, Style } from '../sim/types';
import { ArenaView, TEAMS } from '../render/arena';
import { setMuted, sfx, unlockAudio } from '../render/audio';
import { placeholderSheet } from '../render/placeholder';
import { ROW_NAMES, SPRITES } from '../render/sprites';
import { h } from './dom';

export interface ArenaCtx {
  state: { a: Gladiator; b: Gladiator; seed: number; speed: number; blood: boolean; sound: boolean };
  cfg: Config;
  persist: () => void;
}

let view: ArenaView | null = null;
let lastChoice: MercyChoice | undefined;

export function stopArena() {
  view?.destroy();
  view = null;
}

export function playArena(ctx: ArenaCtx, replay = false) {
  const host = document.getElementById('arena-host');
  if (!host) return;
  stopArena();
  unlockAudio();
  const s = ctx.state;
  if (!replay) lastChoice = undefined;
  view = new ArenaView(host, s.a, s.b, s.seed, ctx.cfg, {
    blood: s.blood,
    speed: s.speed,
    choice: replay ? lastChoice : undefined,
    onDecision: (c) => (lastChoice = c),
    onReplay: () => playArena(ctx, true),
    onNewFight: () => {
      s.seed = (Math.random() * 1e9) >>> 0;
      ctx.persist();
      const seedIn = document.getElementById('arena-seed') as HTMLInputElement | null;
      if (seedIn) seedIn.value = String(s.seed);
      playArena(ctx);
    },
  });
  void view.start();
}

function seg<T extends string | number>(cur: T, opts: [T, string][], on: (v: T) => void) {
  const wrap = h('div', { class: 'seg' });
  const btns = opts.map(([v, label]) =>
    h(
      'button',
      {
        class: `seg-btn ${v === cur ? 'on' : ''}`,
        onclick: () => {
          sfx.click();
          btns.forEach((b) => b.classList.remove('on'));
          btns[opts.findIndex((o) => o[0] === v)].classList.add('on');
          on(v);
        },
      },
      label,
    ),
  );
  wrap.append(...btns);
  return wrap;
}

function matchup(ctx: ArenaCtx) {
  const side = (g: Gladiator, i: 0 | 1) => {
    const k = power(g, ctx.cfg);
    return h(
      'div',
      { class: `mu side${i}` },
      h('b', {}, g.name || (i ? 'B' : 'A')),
      h('small', { class: 'muted' }, ` ${STYLE_NAMES[g.style]} · K ${k.toFixed(2)} · ${arenaClass(k, ctx.cfg).name}`),
    );
  };
  return h('div', { class: 'matchup' }, side(ctx.state.a, 0), h('span', { class: 'vs' }, 'vs'), side(ctx.state.b, 1));
}

export function renderArena(root: HTMLElement, ctx: ArenaCtx) {
  const s = ctx.state;
  const seedIn = h('input', {
    id: 'arena-seed',
    type: 'number',
    class: 'num wide',
    value: s.seed,
    onchange: () => {
      s.seed = Number(seedIn.value) >>> 0;
      ctx.persist();
    },
  });
  const host = h('div', { id: 'arena-host', class: 'arena-host' });
  const start = h(
    'button',
    {
      class: 'btn big gold start-btn',
      onclick: () => playArena(ctx),
    },
    '⚔ Watch fight',
  );
  host.append(h('div', { class: 'arena-placeholder' }, start, h('small', { class: 'muted' }, 'Gladiators and seed come from the Duel tab. Same seed, same fight.')));

  const controls = h(
    'div',
    { class: 'arena-controls' },
    h('label', { class: 'inline' }, 'Seed', seedIn),
    h('button', { class: 'btn small ghost', title: 'New seed', onclick: () => { sfx.click(); seedIn.value = String((Math.random() * 1e9) | 0); seedIn.onchange?.(new Event('change')); } }, '🎲'),
    h('button', { class: 'btn gold', onclick: () => playArena(ctx) }, '⚔ Fight'),
    h('span', { class: 'sep' }),
    h('small', { class: 'muted' }, 'Speed'),
    seg(s.speed, [[0.5, '½×'], [1, '1×'], [2, '2×']], (v) => { s.speed = v; ctx.persist(); view?.setSpeed(v); }),
    h('button', { class: 'btn small', title: 'Fast-forward to the next part', onclick: () => { sfx.click(); view?.skip(); } }, '▸▸ Skip'),
    h('span', { class: 'sep' }),
    h('small', { class: 'muted' }, 'Blood'),
    seg(s.blood ? 'on' : 'off', [['on', 'On'], ['off', 'Off']], (v) => { s.blood = v === 'on'; ctx.persist(); view?.setBlood(s.blood); }),
    h('small', { class: 'muted' }, 'Sound'),
    seg(s.sound ? 'on' : 'off', [['on', 'On'], ['off', 'Off']], (v) => { s.sound = v === 'on'; setMuted(!s.sound); ctx.persist(); }),
  );

  root.replaceChildren(
    h('section', { class: 'card arena-card' }, matchup(ctx), controls, host),
    spritesCard(),
  );
}

function spritesCard() {
  const styles: Style[] = ['heavy', 'swift', 'spear'];
  const grid = h('div', { class: 'sheets' });
  for (const st of styles) {
    const def = SPRITES[st];
    const sheet = placeholderSheet(st, TEAMS[0], def);
    const shown = h('canvas', { class: 'sheet', width: sheet.width, height: sheet.height });
    shown.getContext('2d')!.drawImage(sheet, 0, 0);
    shown.style.width = `${sheet.width * 2}px`;
    const labels = h('div', { class: 'sheet-rows' }, ...ROW_NAMES.map((n) => h('div', { style: `height:${def.frameH * 2}px` }, n)));
    grid.append(
      h(
        'div',
        { class: 'sheet-box' },
        h('div', { class: 'row gap' }, h('b', {}, STYLE_NAMES[st]), h('small', { class: 'muted' }, def.src ? def.src : 'placeholder'),
          h('button', { class: 'btn small ghost', onclick: () => { const a = document.createElement('a'); a.href = sheet.toDataURL('image/png'); a.download = `${st}-template.png`; a.click(); } }, '⤓ PNG template')),
        h('div', { class: 'sheet-wrap' }, labels, shown),
      ),
    );
  }
  return h(
    'section',
    { class: 'card' },
    h('h2', {}, 'Sprite sheets', h('small', { class: 'muted' }, ' 32×32 per frame, one row per animation')),
    h('p', { class: 'muted' }, 'To use your own art: put a PNG into public/sprites/, set src in src/render/sprites.ts and adjust rows and frame counts. Only idle, walk, attack, hit and death are required; the rest falls back.'),
    grid,
  );
}
