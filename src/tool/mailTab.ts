// Tab „Mailbox“: Briefe nach Kämpfen, aus der Mine und vom System. Der Titel verrät das Ergebnis nie.
// Bei Kämpfen: „Show result“ oder „Watch replay“. Bonus-Loot wird einzeln aufgedeckt, das Seltenste zuletzt,
// mit Labels und Beams wie in PoE2. „Claim all“ legt alles ins Inventar. Im Postfach verfällt nichts.

import type { Config } from '../sim/config';
import { claimMail, hasClaim, unreadCount, type Mail, type MailKind } from '../sim/game';
import { entryDetail, entryName, entryRarity, rarityRank, type LootEntry } from '../sim/loot';
import { formatMoney, MAIL_TABS, UI3 } from '../sim/names';
import { entryIcon } from '../render/icons';
import { sfx, unlockAudio } from '../render/audio';
import { h } from './dom';
import { ago, changed, gs } from './gameCtl';
import { flyIcons, iconImg, lootLabel, lootRow } from './lootUi';
import type { FightMail } from '../sim/game';

export interface MailCtx {
  cfg: () => Config;
  replay: (f: FightMail, mailId: number) => void;
}

let tab: MailKind = 'fight';
let selected: number | null = null;
let revealTimers: number[] = [];

function clearTimers() {
  revealTimers.forEach((t) => clearTimeout(t));
  revealTimers = [];
}
export function stopMail() {
  clearTimers();
}

/** Beim Öffnen aus einer Benachrichtigung direkt den richtigen Brief zeigen. */
export function selectMail(id: number) {
  const m = gs().mail.find((x) => x.id === id);
  if (m) {
    tab = m.kind;
    selected = id;
  }
}

/** Beim Öffnen des Postfachs: ist im aktuellen Reiter nichts Neues, zum neuesten ungelesenen Brief springen. */
export function focusUnread() {
  const g = gs();
  if (unreadCount(g, tab) > 0) return;
  const m = g.mail.find((x) => !x.read || (!x.claimed && hasClaim(x)));
  if (m) {
    tab = m.kind;
    selected = m.id;
  }
}

const KIND_ICON: Record<MailKind, string> = { fight: '⚔', mine: '⛏', system: '✉' };

export function renderMail(root: HTMLElement, ctx: MailCtx) {
  clearTimers();
  const g = gs();
  const list = g.mail.filter((m) => m.kind === tab);
  if (selected === null || !list.some((m) => m.id === selected)) selected = list[0]?.id ?? null;
  const rerender = () => renderMail(root, ctx);

  const tabs = h(
    'div',
    { class: 'mail-tabs' },
    ...(Object.keys(MAIL_TABS) as MailKind[]).map((k) => {
      const n = unreadCount(g, k);
      return h(
        'button',
        {
          class: `mail-tab ${tab === k ? 'on' : ''}`,
          onclick: () => {
            sfx.click();
            tab = k;
            selected = null;
            rerender();
          },
        },
        MAIL_TABS[k],
        n ? h('span', { class: 'badge-red' }, String(n)) : null,
      );
    }),
  );

  const items = list.map((m) => {
    const pending = !m.read || (!m.claimed && hasClaim(m));
    return h(
      'button',
      {
        class: `mail-item ${m.id === selected ? 'on' : ''} ${pending ? 'unread' : ''}`,
        onclick: () => {
          sfx.click();
          selected = m.id;
          rerender();
        },
      },
      h('span', { class: 'mail-ico' }, KIND_ICON[m.kind]),
      h('span', { class: 'mail-txt' }, h('b', {}, m.title), h('small', { class: 'muted' }, `${m.subtitle} · ${ago(m.at)}`)),
      pending ? h('i', { class: 'dot' }) : m.claimed && hasClaim(m) ? h('small', { class: 'claimed-tick' }, '✓') : null,
    );
  });

  const sel = list.find((m) => m.id === selected) ?? null;
  if (sel && !sel.read) {
    sel.read = true;
    changed();
  }

  root.replaceChildren(
    h(
      'section',
      { class: 'card mailbox' },
      h(
        'aside',
        { class: 'mail-list' },
        h('h2', {}, UI3.mailbox),
        tabs,
        h('div', { class: 'mail-items' }, ...(items.length ? items : [h('p', { class: 'muted empty-note' }, 'No mail here yet.')])),
      ),
      h('div', { class: 'mail-detail' }, sel ? detail(sel, ctx, rerender) : h('p', { class: 'muted empty-note' }, 'Select a letter.')),
    ),
  );
}

function detail(m: Mail, ctx: MailCtx, rerender: () => void): HTMLElement {
  const cfg = ctx.cfg();
  const f = m.fight;
  const head = h(
    'div',
    { class: 'md-head' },
    h('div', {}, h('h2', { class: 'md-title' }, m.title), h('div', { class: 'muted' }, `${m.subtitle} · ${ago(m.at)}`)),
    f ? h('button', { class: 'btn', onclick: () => { sfx.click(); m.revealed = true; changed(); ctx.replay(f, m.id); } }, `▶ ${UI3.watchReplay}`) : null,
  );

  // Kampf, Ergebnis noch verdeckt
  if (f && !m.revealed) {
    return h(
      'div',
      { class: 'md' },
      head,
      h(
        'div',
        { class: 'sealed' },
        h('div', { class: 'seal' }, '?'),
        h('p', { class: 'muted' }, `${f.className} Arena · ${f.a.name} vs ${f.b.name}. Did you win?`),
        h(
          'div',
          { class: 'row gap' },
          h('button', { class: 'btn gold big-cta', onclick: () => { unlockAudio(); m.revealed = true; changed(); sfx.horn(); rerender(); } }, UI3.showResult),
          h('button', { class: 'btn big-cta', onclick: () => { sfx.click(); m.revealed = true; changed(); ctx.replay(f, m.id); } }, `▶ ${UI3.watchReplay}`),
        ),
      ),
    );
  }

  const left = h('div', { class: 'md-left' });
  if (f) {
    left.append(h('div', { class: `verdict ${f.playerWon ? 'win' : 'loss'}` }, f.playerWon ? UI3.victory : UI3.defeat));
    for (const l of f.lines) left.append(h('div', { class: `sum-line ${l.tone ?? ''}` }, h('span', {}, l.label), h('b', {}, l.value)));
    if (f.gear.length || f.trashed.length) {
      left.append(h('h3', {}, `Loot from ${f.b.name}`));
      for (const e of f.gear) left.append(lootRow(e, cfg));
      if (f.trashed.length) left.append(h('small', { class: 'muted' }, `Destroyed in the fight: ${f.trashed.join(', ')} (stones lost)`));
    }
  } else {
    if (m.body) left.append(h('p', {}, m.body));
    if (m.silver) left.append(h('div', { class: 'sum-line gold' }, h('span', {}, 'Gold'), h('b', {}, `+${formatMoney(m.silver)}`)));
  }

  const right = m.loot.length ? bonusPanel(m, cfg, f ? UI3.bonusLoot : m.kind === 'mine' ? 'Haul' : 'Gift') : null;

  const claimBtn = h('button', { class: 'btn gold claim-btn' }, m.claimed ? `✓ ${UI3.claimed}` : UI3.claimAll) as HTMLButtonElement;
  claimBtn.disabled = m.claimed || !hasClaim(m);
  claimBtn.onclick = () => {
    unlockAudio();
    // Noch verdeckte Karten sofort aufdecken, dann abholen
    right?.querySelectorAll<HTMLElement>('.lc:not(.open)').forEach((el) => el.click());
    const urls = [...(f?.gear ?? []), ...m.loot].map(entryIcon);
    if (!claimMail(gs(), m)) return;
    sfx.claim();
    flyIcons(claimBtn, document.getElementById('tab-inventory'), urls.length ? urls : []);
    changed();
    setTimeout(rerender, 350);
  };

  return h(
    'div',
    { class: 'md' },
    head,
    h('div', { class: `md-body ${right && f ? '' : 'single'}` }, left, right),
    h('div', { class: 'md-foot' }, h('small', { class: 'muted' }, `${UI3.neverExpires}`), hasClaim(m) ? claimBtn : null),
  );
}

/** Verdeckte Karten, eine nach der anderen aufgedeckt. Vor der seltensten Karte etwas Spannung. */
function bonusPanel(m: Mail, cfg: Config, title: string): HTMLElement {
  const loot = m.loot; // schon in Aufdeck-Reihenfolge gespeichert
  const shown = m.claimed || m.lootShown;
  const flash = h('div', { class: 'bp-flash' });
  const row = h('div', { class: 'lc-row' });
  const panel = h('div', { class: 'bonus-panel' }, h('div', { class: 'bp-head' }, h('b', {}, title), h('small', { class: 'muted' }, UI3.revealHint)), row, flash);
  let opened = 0;
  const cards = loot.map((e) => {
    const r = entryRarity(e);
    const el = h(
      'div',
      { class: `lc r-${r}` },
      h('div', { class: 'beam' }),
      h('div', { class: 'lc-back' }, h('span', {}, '?')),
      h('div', { class: 'lc-front' }, h('div', { class: `ico-box big r-${r}` }, iconImg(entryIcon(e))), lootLabel(entryName(e, cfg), r), h('small', { class: 'muted' }, entryDetail(e, cfg))),
    );
    el.onclick = () => open(el, e);
    row.append(el);
    return el;
  });
  const open = (el: HTMLElement, e: LootEntry) => {
    if (el.classList.contains('open')) return;
    el.classList.remove('shake');
    el.classList.add('open');
    const rank = rarityRank(entryRarity(e));
    if (!shown) {
      sfx.reveal(rank);
      if (rank >= 3) {
        flash.classList.remove('go');
        void flash.offsetWidth;
        flash.className = `bp-flash go r-${entryRarity(e)}`;
      }
    }
    opened++;
    if (opened === loot.length) {
      m.lootShown = true;
      changed();
    }
  };
  if (shown) {
    cards.forEach((el, i) => open(el, loot[i]));
  } else {
    // automatische Reihenfolge; ein Klick deckt sofort auf
    let t = 500;
    loot.forEach((e, i) => {
      const last = i === loot.length - 1;
      const rank = rarityRank(entryRarity(e));
      if (last && rank >= 2 && loot.length > 1) {
        revealTimers.push(window.setTimeout(() => { cards[i].classList.add('shake'); sfx.suspense(); }, t));
        t += 1100;
      }
      revealTimers.push(window.setTimeout(() => open(cards[i], e), t));
      t += 550;
    });
  }
  return panel;
}
