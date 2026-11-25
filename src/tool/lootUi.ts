// Gemeinsame Bausteine für Loot: PoE2-artige Labels, Icon-Zeilen, fliegende Icons zum Tab.

import type { Config } from '../sim/config';
import { entryDetail, entryName, entryRarity, type LootEntry } from '../sim/loot';
import type { Rarity } from '../sim/types';
import { entryIcon } from '../render/icons';
import { h } from './dom';

/** Label im Stil von PoE2: Rahmen und Schrift in der Farbe der Seltenheit, Mythic weiß mit dunkelroter Schrift. */
export function lootLabel(text: string, rarity: Rarity, big = false) {
  return h('span', { class: `lbl r-${rarity} ${big ? 'big' : ''}` }, text);
}

export function iconImg(url: string, cls = 'ico') {
  return h('img', { class: cls, src: url, alt: '', draggable: false });
}

export function lootRow(e: LootEntry, cfg: Config) {
  const r = entryRarity(e);
  return h(
    'div',
    { class: 'loot-row' },
    h('div', { class: `ico-box r-${r}` }, iconImg(entryIcon(e))),
    h('div', {}, lootLabel(entryName(e, cfg), r), h('div', { class: 'muted small' }, entryDetail(e, cfg))),
  );
}

/** Icons fliegen von einem Element zu einem anderen (z. B. zum Tab „Inventory“). */
export function flyIcons(from: Element, to: Element | null, urls: string[]) {
  if (!to) return;
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  urls.slice(0, 8).forEach((u, i) => {
    const img = iconImg(u, 'fly-ico');
    const x0 = a.left + a.width / 2 + (Math.random() - 0.5) * 40;
    const y0 = a.top + a.height / 2 + (Math.random() - 0.5) * 20;
    const x1 = b.left + b.width / 2;
    const y1 = b.top + b.height / 2;
    img.style.left = `${x0}px`;
    img.style.top = `${y0}px`;
    document.body.append(img);
    const anim = img.animate(
      [
        { transform: 'translate(-50%, -50%) scale(1.6)', opacity: 1 },
        { transform: `translate(calc(-50% + ${(x1 - x0) * 0.4}px), calc(-50% + ${(y1 - y0) * 0.4 - 60}px)) scale(2)`, opacity: 1, offset: 0.45 },
        { transform: `translate(calc(-50% + ${x1 - x0}px), calc(-50% + ${y1 - y0}px)) scale(.8)`, opacity: 0.2 },
      ],
      { duration: 650 + i * 60, delay: i * 50, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' },
    );
    anim.onfinish = () => {
      img.remove();
      to.classList.remove('bump');
      void (to as HTMLElement).offsetWidth;
      to.classList.add('bump');
    };
  });
}

export function toast(text: string) {
  const t = h('div', { class: 'toast' }, text);
  document.body.append(t);
  setTimeout(() => t.remove(), 1800);
}
