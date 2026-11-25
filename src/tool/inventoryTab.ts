// Tab „Inventory“: Geld und Ruhm, Gladiatoren, Minen-Karten, Ausrüstung, Edelsteine und Rohstoffe.

import type { Config } from '../sim/config';
import { RES_RARITY, RESOURCE_IDS, rarityRank, stoneDetail, stoneName, itemDetail } from '../sim/loot';
import { formatMoney, RARITY_NAMES, RESOURCE_NAMES, STYLE_NAMES } from '../sim/names';
import { arenaClass, power } from '../sim/stats';
import type { Gladiator, Stone } from '../sim/types';
import { cardIcon, itemIcon, resIcon, stoneIcon } from '../render/icons';
import { placeholderSheet } from '../render/placeholder';
import { SPRITES } from '../render/sprites';
import { TEAMS } from '../render/arena';
import { sfx } from '../render/audio';
import { h } from './dom';
import { changed, gs } from './gameCtl';
import { placeFromInventory } from '../sim/game';
import { iconImg, lootLabel, toast } from './lootUi';

export interface InvCtx {
  cfg: () => Config;
  gladiators: () => [Gladiator, Gladiator];
  goto: (tab: 'island') => void;
}

function portrait(g: Gladiator, side: 0 | 1) {
  const def = SPRITES[g.style];
  const sheet = placeholderSheet(g.style, TEAMS[side], def);
  const cv = h('canvas', { class: 'portrait', width: def.frameW, height: def.frameH });
  const c = cv.getContext('2d')!;
  c.drawImage(sheet, 0, def.anims.idle.row * def.frameH, def.frameW, def.frameH, 0, 0, def.frameW, def.frameH);
  return cv;
}

function stoneKey(s: Stone) {
  return `${s.rarity}:${s.kind.type === 'base' ? `base-${s.kind.stat}` : s.kind.type}`;
}

export function renderInventory(root: HTMLElement, ctx: InvCtx) {
  const g = gs();
  const cfg = ctx.cfg();
  const rerender = () => renderInventory(root, ctx);

  const wallet = h(
    'div',
    { class: 'wallet' },
    h('div', { class: 'tile' }, h('small', { class: 'muted' }, 'Gold'), h('b', { class: g.silver < 0 ? 'neg' : 'gold-txt' }, formatMoney(g.silver))),
    h('div', { class: 'tile' }, h('small', { class: 'muted' }, 'Fame'), h('b', {}, String(g.fame))),
    h('div', { class: 'tile' }, h('small', { class: 'muted' }, 'Honor'), h('b', { class: 'good-txt' }, String(g.honor))),
    h('div', { class: 'tile' }, h('small', { class: 'muted' }, 'Butcher'), h('b', { class: 'bad-txt' }, String(g.butcher))),
  );

  const glads = ctx.gladiators().map((gl, i) => {
    const k = power(gl, cfg);
    return h(
      'div',
      { class: `glad-card r-${gl.rarity}` },
      h('div', { class: 'gc-top' }, h('small', { class: `rar r-${gl.rarity}` }, RARITY_NAMES[gl.rarity]), h('small', { class: 'muted' }, i === 0 ? 'You fight with' : 'Sparring partner')),
      portrait(gl, i as 0 | 1),
      h('b', { class: 'gc-name' }, gl.name),
      h('small', { class: 'muted' }, `${STYLE_NAMES[gl.style]} · K ${k.toFixed(1)} · ${arenaClass(k, cfg).name}`),
    );
  });

  // Karten: im Inventar und auf der Insel
  const placed = g.plots.filter((p) => p.card).map((p) => ({ card: p.card!, onIsland: true }));
  const allCards = [...g.cards.map((card) => ({ card, onIsland: false })), ...placed].sort((a, b) => rarityRank(b.card.rarity) - rarityRank(a.card.rarity));
  const freePlot = g.plots.findIndex((p) => !p.card);
  const cards = allCards.map(({ card, onIsland }) =>
    h(
      'div',
      { class: `inv-card r-${card.rarity}` },
      iconImg(cardIcon(card.rarity), 'ico big'),
      h('div', {}, lootLabel(cfg.mine.cards[card.rarity].name, card.rarity), h('div', { class: 'muted small' }, `${RARITY_NAMES[card.rarity]} mine · ${card.runsLeft}/${card.runsTotal} runs`), h('div', { class: 'mc-wear thin' }, h('div', { class: 'mc-wear-fill', style: `width:${(card.runsLeft / card.runsTotal) * 100}%` }))),
      onIsland
        ? h('small', { class: 'tag' }, 'On island')
        : h(
            'button',
            {
              class: 'btn small gold',
              disabled: freePlot < 0,
              title: freePlot < 0 ? 'No free plot on the island' : 'Place on the island',
              onclick: () => {
                if (!placeFromInventory(g, freePlot, card.id)) return;
                sfx.fanfare();
                changed();
                ctx.goto('island');
              },
            },
            'Place',
          ),
    ),
  );

  const items = [...g.items]
    .sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity))
    .map((it) =>
      h(
        'div',
        { class: 'inv-item' },
        h('div', { class: `ico-box r-${it.rarity}` }, iconImg(itemIcon(it.slot, it.rarity))),
        h(
          'div',
          {},
          lootLabel(it.name, it.rarity),
          h('div', { class: 'muted small' }, `${RARITY_NAMES[it.rarity]} · ${itemDetail(it)}`),
          it.sockets
            ? h('div', { class: 'sockets' }, ...Array.from({ length: it.sockets }, (_, i) => (it.stones[i] ? h('span', { class: `sock r-${it.stones[i].rarity}`, title: stoneName(it.stones[i]) }, iconImg(stoneIcon(it.stones[i]))) : h('span', { class: 'sock empty' }))))
            : null,
        ),
      ),
    );

  const stacks = new Map<string, { s: Stone; n: number }>();
  for (const s of g.stones) {
    const k = stoneKey(s);
    const st = stacks.get(k);
    if (st) st.n++;
    else stacks.set(k, { s, n: 1 });
  }
  const stones = [...stacks.values()]
    .sort((a, b) => rarityRank(b.s.rarity) - rarityRank(a.s.rarity))
    .map(({ s, n }) =>
      h(
        'div',
        { class: `slot-box r-${s.rarity}`, title: `${stoneName(s)} · ${RARITY_NAMES[s.rarity]} · ${stoneDetail(s, cfg)}` },
        iconImg(stoneIcon(s), 'ico big'),
        h('span', { class: 'count' }, String(n)),
        h('span', { class: 'slot-name' }, lootLabel(stoneName(s), s.rarity)),
      ),
    );

  const mats = RESOURCE_IDS.filter((r) => (g.res[r] ?? 0) > 0)
    .sort((a, b) => rarityRank(RES_RARITY[b]) - rarityRank(RES_RARITY[a]))
    .map((r) =>
      h(
        'div',
        { class: `slot-box r-${RES_RARITY[r]}`, title: `${RESOURCE_NAMES[r]} · ${RARITY_NAMES[RES_RARITY[r]]}` },
        iconImg(resIcon(r), 'ico big'),
        h('span', { class: 'count' }, String(g.res[r])),
        h('span', { class: 'slot-name' }, lootLabel(RESOURCE_NAMES[r], RES_RARITY[r])),
      ),
    );

  const section = (title: string, sub: string, body: HTMLElement[], empty: string, cls = '') =>
    h('section', { class: 'card' }, h('h2', {}, title, h('small', { class: 'muted' }, sub)), body.length ? h('div', { class: cls }, ...body) : h('p', { class: 'muted' }, empty));

  root.replaceChildren(
    h('section', { class: 'card' }, h('h2', {}, 'Inventory', h('small', { class: 'muted' }, 'Everything you own. Loot arrives through the mailbox.')), wallet),
    section('Gladiators', 'from the Duel tab', glads, '', 'glad-row'),
    section('Mine cards', `${allCards.length} card${allCards.length === 1 ? '' : 's'}`, cards, 'No mine cards.', 'card-row'),
    section('Gear', `${g.items.length} items · from opponents you killed`, items, 'No gear yet. Kill an opponent to take their gear (full loot).', 'item-grid'),
    section('Gems', `${g.stones.length} stones · lost when the item they sit in is destroyed`, stones, 'No gems yet. Winners get bonus gems by arena class.', 'slot-grid'),
    section('Materials', 'from mines and arenas', mats, 'No materials yet. Collect your mine.', 'slot-grid'),
    h(
      'section',
      { class: 'card' },
      h('h2', {}, 'Test controls'),
      h(
        'div',
        { class: 'row gap wrap' },
        h('button', { class: 'btn small', onclick: () => { g.silver += 10000; sfx.coin(); changed(); rerender(); } }, '+100 Gold'),
        h('button', { class: 'btn small danger', onclick: () => { g.items = []; g.stones = []; g.res = {}; sfx.click(); changed(); rerender(); toast('Inventory cleared'); } }, 'Clear items, gems, materials'),
      ),
    ),
  );
}
