// Tab „Island“: die Minen-Karten als Gebäude auf der Insel. Jede Mine zeigt den Arbeiter im Takt
// des Durchgangs, einen Ladebalken, das Lager (Lore) und den Verschleiß. „Collect“ schickt das Lager ins Postfach.

import type { Config, MineRarity } from '../sim/config';
import { collectMine, placeFromInventory, removeWornCard, unplaceCard } from '../sim/game';
import { entryRarity, mergeLoot, rarityRank, RES_RARITY, entryName, type LootEntry } from '../sim/loot';
import { expectedPerRun, makeMineCard, mineStatus, tickPlot, type Plot } from '../sim/mine';
import { RARITY_NAMES, RESOURCE_NAMES, UI3 } from '../sim/names';
import { cardIcon, entryIcon, RARITY_COLORS, resIcon } from '../render/icons';
import { MineScene } from '../render/mineScene';
import { sfx, unlockAudio } from '../render/audio';
import { h } from './dom';
import { ago, changed, gs, on } from './gameCtl';
import { flyIcons, iconImg, lootLabel, toast } from './lootUi';

export interface IslandCtx {
  cfg: () => Config;
  goto: (tab: 'mail' | 'inventory') => void;
}

let off: (() => void) | null = null;
export function stopIsland() {
  off?.();
  off = null;
}

const WORKERS = ['Hob', 'Moss', 'Grit', 'Pip', 'Dunk', 'Bramble'];

class MineView {
  root: HTMLElement;
  private scene: MineScene;
  private popLayer: HTMLElement;
  private fill: HTMLElement;
  private barLabel: HTMLElement;
  private runLabel: HTMLElement;
  private pips: HTMLElement[] = [];
  private wearFill: HTMLElement;
  private wearLabel: HTMLElement;
  private collectBtn: HTMLButtonElement;
  private status = '';
  private strikeSound = 0;

  constructor(
    readonly plotIdx: number,
    private ctx: IslandCtx,
    private rerender: () => void,
  ) {
    const p = this.plot;
    const card = p.card!;
    const cfg = ctx.cfg();
    const def = cfg.mine.cards[card.rarity];
    this.scene = new MineScene(card.rarity);
    this.scene.onStrike = () => {
      // höchstens ein Klang pro 0,25 s, damit Zeitraffer nicht knattert
      const now = performance.now();
      if (now - this.strikeSound > 250) {
        this.strikeSound = now;
        sfx.pick();
      }
    };
    this.popLayer = h('div', { class: 'mc-pops' });
    this.fill = h('div', { class: 'mc-fill' });
    this.barLabel = h('span', { class: 'mc-bar-label' });
    this.runLabel = h('span', {});
    this.wearFill = h('div', { class: 'mc-wear-fill' });
    this.wearLabel = h('small', { class: 'muted' });
    this.collectBtn = h('button', { class: 'btn gold collect', onclick: () => this.collect() }, UI3.collect) as HTMLButtonElement;
    const pipBox = h('div', { class: 'mc-pips' });
    for (let i = 0; i < cfg.mine.storageRuns; i++) {
      const pip = h('i', {});
      this.pips.push(pip);
      pipBox.append(pip);
    }
    const worker = WORKERS[card.seed % WORKERS.length];
    const chips = def.drops.map((d) => {
      const name = d.res === 'gem' ? `${RARITY_NAMES[d.gemRarity ?? 'common']} Gem` : RESOURCE_NAMES[d.res];
      const rar = d.res === 'gem' ? d.gemRarity ?? 'common' : RES_RARITY[d.res];
      const lo = d.res === 'gem' ? d.min : Math.max(1, Math.round(d.min * def.yieldMult));
      const hi = d.res === 'gem' ? d.max : Math.max(1, Math.round(d.max * def.yieldMult));
      const amount = d.chance >= 1 ? `${lo === hi ? lo : `${lo}–${hi}`} ×` : `${fmtPct(d.chance)}`;
      return h('span', { class: `chip r-${rar}` }, h('b', {}, amount), ' ', name);
    });
    const sceneBox = h('div', { class: 'mc-scene' }, this.scene.canvas, this.popLayer);
    this.root = h(
      'div',
      { class: `mine-card r-${card.rarity}` },
      h('div', { class: 'mc-head' }, h('b', {}, def.name), h('span', { class: `rar r-${card.rarity}` }, RARITY_NAMES[card.rarity])),
      sceneBox,
      h('div', { class: 'mc-info' }, this.runLabel, h('small', { class: 'muted' }, `Worker ${worker} · ${cfg.mine.cycleSeconds} s per run`)),
      h('div', { class: 'mc-bar' }, this.fill, this.barLabel),
      h('div', { class: 'mc-row' }, h('small', { class: 'muted' }, UI3.storage), pipBox, this.collectBtn),
      h('div', { class: 'mc-row' }, h('small', { class: 'muted' }, 'Wear'), h('div', { class: 'mc-wear' }, this.wearFill), this.wearLabel),
      h('div', { class: 'mc-chips' }, ...chips),
      h(
        'div',
        { class: 'mc-foot' },
        h('button', { class: 'btn small ghost', title: 'Back to inventory (storage must be empty)', onclick: () => this.unplace() }, '↩ Take card back'),
      ),
    );
    // Breite erst nach dem Einhängen bekannt
    requestAnimationFrame(() => this.scene.fit(sceneBox.clientWidth || 384));
    this.update(0);
  }

  get plot(): Plot {
    return gs().plots[this.plotIdx];
  }

  fit() {
    const box = this.scene.canvas.parentElement;
    if (box) this.scene.fit(box.clientWidth);
  }

  update(dt: number) {
    const p = this.plot;
    if (!p.card) return;
    const cfg = this.ctx.cfg();
    const st = mineStatus(p, cfg);
    const frac = Math.min(1, p.progress / cfg.mine.cycleSeconds);
    const fillFrac = p.storage.length / cfg.mine.storageRuns;
    const f = { progress: frac, status: st, fill: Math.min(1, fillFrac) };
    this.scene.step(dt, f);
    this.scene.draw(f);
    this.fill.style.width = `${(st === 'running' ? frac : st === 'full' ? 1 : 0) * 100}%`;
    if (st !== this.status) {
      this.status = st;
      this.root.classList.toggle('is-full', st === 'full');
      this.root.classList.toggle('is-worn', st === 'worn');
    }
    const left = Math.max(0, (cfg.mine.cycleSeconds - p.progress) / Math.max(0.001, gs().timeScale));
    this.barLabel.textContent =
      st === 'full' ? `${UI3.storageFull} · collect to keep mining` : st === 'worn' ? `${UI3.wornOut} · card used up` : `${left.toFixed(1)} s`;
    this.runLabel.textContent = `${UI3.run} ${p.runNo + (st === 'running' ? 1 : 0)}`;
    this.pips.forEach((pip, i) => pip.classList.toggle('on', i < p.storage.length));
    const n = p.storage.length;
    this.collectBtn.disabled = n === 0;
    this.collectBtn.textContent = n ? `${UI3.collect} (${n})` : UI3.collect;
    this.wearFill.style.width = `${(p.card.runsLeft / p.card.runsTotal) * 100}%`;
    this.wearLabel.textContent = `${p.card.runsLeft}/${p.card.runsTotal} ${UI3.runsLeft}`;
  }

  onDrops(drops: LootEntry[]) {
    const merged = mergeLoot(drops);
    const best = merged.reduce((m, e) => (rarityRank(entryRarity(e)) > rarityRank(entryRarity(m)) ? e : m), merged[0]);
    const rare = best && rarityRank(entryRarity(best)) >= 1;
    this.scene.burst(drops, rare ? RARITY_COLORS[entryRarity(best)] : null);
    // Einblendung über der Lore, die seltenste Zeile zuerst und größer
    const [x, y] = this.scene.cartTop;
    const lines = [...merged].sort((a, b) => rarityRank(entryRarity(b)) - rarityRank(entryRarity(a))).slice(0, 3);
    lines.forEach((e, i) => {
      const r = entryRarity(e);
      const pop = h('div', { class: `mc-pop r-${r} ${i === 0 && rare ? 'big' : ''}` }, iconImg(entryIcon(e)), `+${entryName(e, this.ctx.cfg())}`);
      pop.style.left = `${x}px`;
      pop.style.top = `${y - i * 18}px`;
      pop.style.animationDelay = `${0.45 + i * 0.12}s`;
      this.popLayer.append(pop);
      setTimeout(() => pop.remove(), 2600);
    });
    if (rare) setTimeout(() => sfx.reveal(Math.min(2, rarityRank(entryRarity(best)))), 450);
    else setTimeout(() => sfx.clunk(), 500);
  }

  private collect() {
    unlockAudio();
    const g = gs();
    const mail = collectMine(g, this.plotIdx, this.ctx.cfg());
    if (!mail) return;
    sfx.click();
    sfx.mail();
    flyIcons(this.collectBtn, document.getElementById('tab-mail'), mail.loot.map(entryIcon));
    changed();
    if (this.plot.card && this.plot.card.runsLeft <= 0) this.rerender();
    else this.update(0);
  }

  private unplace() {
    if (!unplaceCard(gs(), this.plotIdx)) {
      toast('Collect the storage first');
      return;
    }
    sfx.click();
    changed();
    this.rerender();
  }
}

function fmtPct(v: number) {
  const p = v * 100;
  return `${p >= 10 ? p.toFixed(0) : p.toFixed(p >= 1 ? 0 : 1)} %`;
}

function emptyPlot(idx: number, ctx: IslandCtx, rerender: () => void) {
  const g = gs();
  const cfg = ctx.cfg();
  const cards = [...g.cards].sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity));
  return h(
    'div',
    { class: 'mine-card empty' },
    h('div', { class: 'mc-head' }, h('b', {}, UI3.emptyPlot), h('small', { class: 'muted' }, `Plot ${idx + 1}`)),
    cards.length
      ? h(
          'div',
          { class: 'place-list' },
          h('small', { class: 'muted' }, 'Place a mine card from your inventory:'),
          ...cards.map((c) =>
            h(
              'button',
              {
                class: `place-btn r-${c.rarity}`,
                onclick: () => {
                  unlockAudio();
                  if (placeFromInventory(g, idx, c.id)) {
                    sfx.fanfare();
                    changed();
                    rerender();
                  }
                },
              },
              iconImg(cardIcon(c.rarity)),
              h('span', {}, lootLabel(cfg.mine.cards[c.rarity].name, c.rarity), h('small', { class: 'muted' }, ` ${c.runsLeft}/${c.runsTotal} runs`)),
            ),
          ),
        )
      : h('p', { class: 'muted place-hint' }, 'No mine card in your inventory. Check the mailbox, or add one under Test controls.'),
  );
}

function numbersTable(cfg: Config) {
  const rarities: MineRarity[] = ['common', 'epic', 'mythic'];
  const res = ['copper', 'iron', 'coal', 'obsidian', 'crystalShard'] as const;
  const exp = rarities.map((r) => expectedPerRun(cfg.mine.cards[r]));
  const f = (v: number | undefined) => (v ? (v >= 10 ? v.toFixed(0) : v.toFixed(v >= 1 ? 1 : 2)) : '–');
  return h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Per run (average)'), ...rarities.map((r) => h('th', {}, `${cfg.mine.cards[r].name}`)))),
      h(
        'tbody',
        {},
        h('tr', {}, h('td', {}, 'Lifetime (runs)'), ...rarities.map((r) => h('td', {}, String(cfg.mine.cards[r].runs)))),
        ...res.map((k) => h('tr', {}, h('td', {}, h('img', { class: 'ico inline', src: resIcon(k) }), ' ', RESOURCE_NAMES[k]), ...exp.map((e) => h('td', {}, f(e.res[k]))))),
        h('tr', {}, h('td', {}, 'Gems'), ...exp.map((e) => h('td', {}, Object.entries(e.gems).map(([r, v]) => `${f(v)} ${RARITY_NAMES[r as keyof typeof RARITY_NAMES]}`).join(', ') || '–'))),
        h('tr', {}, h('td', {}, h('b', {}, 'Whole card: crystal shards')), ...rarities.map((r, i) => h('td', {}, h('b', {}, f((exp[i].res.crystalShard ?? 0) * cfg.mine.cards[r].runs))))),
      ),
    ),
    h('p', { class: 'muted small' }, `One run is ${cfg.mine.cycleSeconds} s in the prototype (1 h in the game later). Storage holds ${cfg.mine.storageRuns} runs, then the mine stops without wear. All numbers under Settings → mine.`),
  );
}

export function renderIsland(root: HTMLElement, ctx: IslandCtx) {
  stopIsland();
  const g = gs();
  const cfg = ctx.cfg();
  const views: MineView[] = [];
  const rerender = () => renderIsland(root, ctx);
  const plots = h('div', { class: 'plots' });
  g.plots.forEach((p, i) => {
    if (p.card) {
      if (p.card.runsLeft <= 0 && p.storage.length === 0) {
        const def = cfg.mine.cards[p.card.rarity];
        plots.append(
          h(
            'div',
            { class: 'mine-card is-worn' },
            h('div', { class: 'mc-head' }, h('b', {}, def.name), h('span', { class: `rar r-${p.card.rarity}` }, UI3.wornOut)),
            h('p', { class: 'muted' }, `This card has done all ${p.card.runsTotal} runs.`),
            h('button', { class: 'btn', onclick: () => { removeWornCard(g, i); sfx.click(); changed(); rerender(); } }, '✕ Remove card'),
          ),
        );
        return;
      }
      const v = new MineView(i, ctx, rerender);
      views.push(v);
      plots.append(v.root);
    } else plots.append(emptyPlot(i, ctx, rerender));
  });
  plots.append(h('div', { class: 'mine-card locked' }, h('div', { class: 'locked-in' }, '🔒', h('b', {}, 'Kitchen'), h('small', { class: 'muted' }, 'coming in Milestone 4'))));

  const dropList = h('div', { class: 'drops' });
  const renderDrops = () => {
    dropList.replaceChildren(
      ...(g.drops.length ? g.drops.slice(0, 10).map((d) => h('div', { class: 'drop' }, h('span', { class: `txt r-${d.rarity}` }, d.text), h('small', { class: 'muted' }, ` · ${ago(d.at)}`))) : [h('small', { class: 'muted' }, 'Nothing yet. The first run takes a few seconds.')]),
    );
  };
  renderDrops();

  const scale = h(
    'div',
    { class: 'seg' },
    ...[1, 10, 60].map((s) =>
      h(
        'button',
        {
          class: `seg-btn ${g.timeScale === s ? 'on' : ''}`,
          onclick: (e: Event) => {
            sfx.click();
            g.timeScale = s;
            changed();
            (e.currentTarget as HTMLElement).parentElement!.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('on'));
            (e.currentTarget as HTMLElement).classList.add('on');
          },
        },
        `${s}×`,
      ),
    ),
  );

  const addCard = (r: MineRarity) =>
    h('button', { class: `btn small`, onclick: () => { g.cards.push(makeMineCard(r, ctx.cfg())); sfx.click(); changed(); rerender(); toast(`${cfg.mine.cards[r].name} added to inventory`); } }, `+ ${RARITY_NAMES[r]} card`);

  root.replaceChildren(
    h(
      'div',
      { class: 'island-grid' },
      h(
        'section',
        { class: 'card island' },
        h('h2', {}, 'Your Island', h('small', { class: 'muted' }, `${g.plots.filter((p) => p.card).length} of ${g.plots.length} mine plots used`)),
        plots,
      ),
      h(
        'div',
        { class: 'island-side' },
        h('section', { class: 'card' }, h('h2', {}, 'Recent finds'), dropList),
        h(
          'section',
          { class: 'card' },
          h('h2', {}, 'Test controls'),
          h('label', { class: 'inline' }, 'Clock speed', scale),
          h('div', { class: 'row gap wrap' }, addCard('common'), addCard('epic'), addCard('mythic')),
          h(
            'div',
            { class: 'row gap wrap', style: 'margin-top:8px' },
            h('button', { class: 'btn small', onclick: () => { for (const p of g.plots) tickPlot(p, ctx.cfg().mine.cycleSeconds * ctx.cfg().mine.storageRuns, ctx.cfg()); sfx.click(); changed(); } }, '⏩ Fill all storage'),
            h('button', { class: 'btn small', onclick: () => { for (const p of g.plots) if (p.card) p.card.runsLeft = Math.min(p.card.runsLeft, 1); sfx.click(); changed(); } }, '⌛ Wear out (1 run left)'),
          ),
          h('h3', {}, 'Mine numbers'),
          numbersTable(cfg),
        ),
      ),
    ),
  );

  const onResize = () => views.forEach((v) => v.fit());
  window.addEventListener('resize', onResize);
  let dropTimer = 0;
  const unsub = on({
    frame: (dt) => {
      for (const v of views) v.update(dt);
      dropTimer += dt;
      if (dropTimer > 1) {
        dropTimer = 0;
        renderDrops();
      }
    },
    drops: (plot, drops) => {
      const v = views.find((x) => x.plotIdx === plot);
      v?.onDrops(drops);
      renderDrops();
    },
  });
  off = () => {
    unsub();
    window.removeEventListener('resize', onResize);
  };
}
