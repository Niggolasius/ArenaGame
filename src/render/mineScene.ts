// Die Mine als kleine Pixel-Szene: ein Arbeiter schlägt im Takt des Durchgangs auf den Erzbrocken,
// am Ende jedes Durchgangs fliegt ein Brocken in die Lore. Die Lore füllt sich mit dem Lager.
// Volles Lager: der Arbeiter setzt sich hin und schläft. Verbrauchte Karte: Stollen mit Brettern zu.
// Gezeichnet in niedriger Auflösung (W×H) und ganzzahlig hochskaliert, wie die Arena.

import type { MineRarity } from '../sim/config';
import type { LootEntry } from '../sim/loot';
import type { MineStatus } from '../sim/mine';
import { mulberry32 } from '../sim/rng';
import { MINER, type AnimDef } from './sprites';

export const MW = 112; // Mindestbreite der Szene; breitere Karten zeigen links und rechts mehr Stollen
export const MH = 64;
const FLOOR = 54;
const WORKER_X = 40; // Fußpunkt des Arbeiters
const ROCK_X = 50; // linke Kante des Erzbrockens
const CART_X = 84;
const SWINGS_PER_RUN = 3;

type Ctx = CanvasRenderingContext2D;

interface OreLook {
  ore: string;
  oreHi: string;
  glow: string | null;
}
const ORE: Record<MineRarity, OreLook> = {
  common: { ore: '#c8742a', oreHi: '#f0a95a', glow: null },
  epic: { ore: '#8d98a6', oreHi: '#e1e7ee', glow: null },
  mythic: { ore: '#7a3fc0', oreHi: '#d6a8ff', glow: '#b06cff' },
};

const C = {
  outline: '#1a1210',
  skin: '#d9a066',
  skinShade: '#a86a3c',
  shirt: '#3f6fb0',
  shirtShade: '#2a4a7c',
  pants: '#6b4a2e',
  pantsShade: '#4a321f',
  boot: '#2a1c12',
  helmet: '#e2b44d',
  helmetShade: '#a87a22',
  lamp: '#fff3b0',
  wood: '#8a5a32',
  woodShade: '#5e3b1f',
  woodHi: '#a8743f',
  metal: '#9aa3ad',
  metalShade: '#5d646d',
  metalHi: '#e6ecf1',
  rock: '#5b5149',
  rockShade: '#3e3631',
  rockHi: '#7a6e64',
};

function rect(c: Ctx, x: number, y: number, w: number, h: number, col: string) {
  c.fillStyle = col;
  c.fillRect(Math.round(x), Math.round(y), w, h);
}

function line(c: Ctx, x0: number, y0: number, x1: number, y1: number, col: string, thick = 1) {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  c.fillStyle = col;
  for (let i = 0; i < 512; i++) {
    c.fillRect(x0, y0, thick, thick);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}
const rad = (d: number) => (d * Math.PI) / 180;

// ---------- Platzhalter-Sheet des Arbeiters (32×32 pro Bild, Raster aus sprites.ts) ----------

interface MinerPose {
  angle: number; // Spitzhacke: 0 = nach vorn, -90 = nach oben, 90 = nach unten
  lean: number;
  by: number;
  sit: boolean;
  nod: number;
}

function drawMiner(c: Ctx, p: MinerPose) {
  const lx = p.lean;
  const by = p.by;
  if (p.sit) {
    // sitzt mit ausgestreckten Beinen, Hacke lehnt hinter ihm
    line(c, 6, 29, 12, 12, C.wood);
    line(c, 9, 13, 15, 11, C.metal);
    rect(c, 12, 26, 9, 3, C.pants);
    rect(c, 12, 28, 9, 1, C.pantsShade);
    rect(c, 20, 25, 3, 4, C.boot);
    rect(c, 11, 18, 6, 9, C.shirt);
    rect(c, 11, 24, 6, 3, C.shirtShade);
    rect(c, 15, 21, 4, 2, C.skin); // Arm auf dem Knie
    const hy = 12 + p.nod;
    rect(c, 12, hy, 6, 6, C.skin);
    rect(c, 12, hy + 4, 6, 2, C.skinShade);
    rect(c, 16, hy + 3, 1, 1, C.outline);
    rect(c, 11, hy - 2, 8, 3, C.helmet);
    rect(c, 11, hy, 8, 1, C.helmetShade);
    rect(c, 18, hy - 1, 2, 2, C.lamp);
    return;
  }
  // hinteres Bein, vorderes Bein
  rect(c, 12, 23, 3, 6, C.pantsShade);
  rect(c, 11, 29, 4, 1, C.boot);
  rect(c, 16 + Math.max(0, lx), 23, 3, 6, C.pants);
  rect(c, 16 + Math.max(0, lx), 29, 4, 1, C.boot);
  // Rumpf
  const tx = 11 + lx;
  const ty = 15 + by;
  rect(c, tx, ty, 7, 9, C.shirt);
  rect(c, tx, ty + 6, 7, 3, C.shirtShade);
  rect(c, tx, ty + 7, 7, 1, C.pantsShade); // Gürtel
  // Kopf mit Helm und Lampe
  const hx = 12 + lx;
  const hy = 9 + by;
  rect(c, hx, hy, 6, 6, C.skin);
  rect(c, hx, hy + 4, 6, 2, C.skinShade);
  rect(c, hx + 4, hy + 3, 1, 1, C.outline);
  rect(c, hx - 1, hy - 2, 8, 3, C.helmet);
  rect(c, hx - 1, hy, 8, 1, C.helmetShade);
  rect(c, hx + 6, hy - 1, 2, 2, C.lamp);
  // Arme und Spitzhacke (beide Hände am Stiel)
  const sx = tx + 4;
  const sy = ty + 2;
  const dx = Math.cos(rad(p.angle));
  const dy = Math.sin(rad(p.angle));
  const handX = sx + dx * 4;
  const handY = sy + dy * 4;
  line(c, sx, sy, handX, handY, C.skinShade, 2);
  const len = 11;
  line(c, handX - dx * 2, handY - dy * 2, handX + dx * len, handY + dy * len, C.wood);
  line(c, handX - dx * 2 + 1, handY - dy * 2, handX + dx * len + 1, handY + dy * len, C.woodShade);
  // Kopf der Hacke quer zum Stiel, gebogen
  const ex = handX + dx * len;
  const ey = handY + dy * len;
  const px = -dy;
  const py = dx;
  line(c, ex - px * 4, ey - py * 4, ex + px * 4, ey + py * 4, C.metal);
  line(c, ex + px * 4, ey + py * 4, ex + px * 5 + dx * 2, ey + py * 5 + dy * 2, C.metalHi);
  line(c, ex - px * 4, ey - py * 4, ex - px * 5 + dx, ey - py * 5 + dy, C.metalShade);
  rect(c, sx - 1, sy, 3, 2, C.skin); // Schulter
}

/** Bilder: Zeile 0 Schlag (hitFrame = Aufprall), Zeile 1 Sitzen/Schlafen, Zeile 2 Stehen. */
const SWING_POSES: MinerPose[] = [
  { angle: -30, lean: 0, by: 0, sit: false, nod: 0 },
  { angle: -85, lean: -1, by: 0, sit: false, nod: 0 },
  { angle: -135, lean: -2, by: 0, sit: false, nod: 0 },
  { angle: -45, lean: 1, by: 0, sit: false, nod: 0 },
  { angle: 40, lean: 2, by: 1, sit: false, nod: 0 },
  { angle: 15, lean: 1, by: 0, sit: false, nod: 0 },
];

let minerSheet: HTMLCanvasElement | null = null;
export function minerPlaceholderSheet(): HTMLCanvasElement {
  if (minerSheet) return minerSheet;
  const fw = MINER.frameW;
  const fh = MINER.frameH;
  const cv = document.createElement('canvas');
  cv.width = fw * 6;
  cv.height = fh * 3;
  const c = cv.getContext('2d')!;
  const at = (row: number, col: number, pose: MinerPose) => {
    c.save();
    c.translate(col * fw, row * fh);
    drawMiner(c, pose);
    c.restore();
  };
  SWING_POSES.forEach((p, i) => at(MINER.anims.swing.row, i, p));
  at(MINER.anims.rest.row, 0, { angle: 0, lean: 0, by: 0, sit: true, nod: 0 });
  at(MINER.anims.rest.row, 1, { angle: 0, lean: 0, by: 0, sit: true, nod: 1 });
  at(MINER.anims.idle.row, 0, SWING_POSES[0]);
  at(MINER.anims.idle.row, 1, { ...SWING_POSES[0], by: 1 });
  minerSheet = cv;
  return cv;
}

let loadedSheet: Promise<CanvasImageSource> | null = null;
function loadMinerSheet(): Promise<CanvasImageSource> {
  if (!loadedSheet) {
    loadedSheet = MINER.src
      ? new Promise((res) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = () => res(minerPlaceholderSheet());
          img.src = `${import.meta.env.BASE_URL}${MINER.src}`;
        })
      : Promise.resolve(minerPlaceholderSheet());
  }
  return loadedSheet;
}

/** Welches Bild der Schlag-Animation zu welcher Phase (0..1) gehört. Der Aufprall liegt bei IMPACT. */
const IMPACT = 0.72;
function swingFrame(a: AnimDef, phase: number): number {
  const hit = a.hitFrame ?? Math.floor(a.frames / 2);
  if (phase < IMPACT) {
    // Ausholen bis kurz vor den Aufprall
    return Math.min(hit - 1, Math.floor((phase / IMPACT) * hit));
  }
  const rest = a.frames - hit;
  return Math.min(a.frames - 1, hit + Math.floor(((phase - IMPACT) / (1 - IMPACT)) * rest));
}

// ---------- Hintergrund ----------

function drawBackdrop(rarity: MineRarity, W: number, ox: number): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = MH;
  const c = cv.getContext('2d')!;
  const rng = mulberry32(rarity === 'common' ? 11 : rarity === 'epic' ? 22 : 33);
  rect(c, 0, 0, W, MH, '#231b16');
  // Felswand aus Blöcken
  const cols = ['#2e241e', '#2a211b', '#362b23', '#271f19', '#3a2e25'];
  for (let y = 0; y < FLOOR; y += 5) {
    const off = (y / 5) % 2 ? 4 : 0;
    for (let x = -off; x < W; x += 8) {
      const col = cols[Math.floor(rng() * cols.length)];
      rect(c, x, y, 7, 4, col);
      rect(c, x, y, 7, 1, '#3f332a');
    }
  }
  // ein paar Erzadern in der Wand
  const ore = ORE[rarity];
  for (let i = 0; i < 9; i++) {
    const x = 8 + Math.floor(rng() * (W - 16));
    const y = 12 + Math.floor(rng() * 40);
    rect(c, x, y, 1 + Math.floor(rng() * 2), 1, ore.ore);
  }
  // Boden
  rect(c, 0, FLOOR, W, MH - FLOOR, '#3d3026');
  rect(c, 0, FLOOR, W, 1, '#5a4636');
  for (let i = 0; i < 30; i++) rect(c, Math.floor(rng() * W), FLOOR + 2 + Math.floor(rng() * 9), 2, 1, '#33281f');
  // Schienen für die Lore
  for (let x = ox + CART_X - 8; x < W; x += 5) rect(c, x, FLOOR + 4, 3, 2, C.woodShade);
  rect(c, ox + CART_X - 10, FLOOR + 3, W, 1, C.metalShade);
  // Stützbalken
  const post = (x: number) => {
    rect(c, x, 4, 4, FLOOR - 4, C.wood);
    rect(c, x, 4, 1, FLOOR - 4, C.woodHi);
    rect(c, x + 3, 4, 1, FLOOR - 4, C.woodShade);
  };
  post(3);
  post(W - 7);
  rect(c, 0, 2, W, 4, C.wood);
  rect(c, 0, 2, W, 1, C.woodHi);
  rect(c, 0, 5, W, 1, C.woodShade);
  // Laterne an einer Kette
  const lx = ox + 20;
  line(c, lx, 6, lx, 10, '#4a4a4a');
  rect(c, lx - 2, 10, 5, 6, '#3a2a18');
  rect(c, lx - 1, 11, 3, 4, '#ffd36b');
  rect(c, lx - 2, 16, 5, 1, '#3a2a18');
  return cv;
}

function drawRock(c: Ctx, rarity: MineRarity, x0: number, wear: number) {
  // Hügel aus Zeilen, oben schmaler. `wear` 0..1 trägt ihn ein wenig ab (pro Durchgang wieder voll).
  const ore = ORE[rarity];
  const h = 18 - Math.round(wear * 3);
  for (let i = 0; i < h; i++) {
    const y = FLOOR - 1 - i;
    const half = Math.round(13 * Math.sqrt(1 - (i / (h + 2)) ** 2));
    const cx = x0 + 14;
    rect(c, cx - half, y, half * 2, 1, i > h - 4 ? C.rockHi : i < 3 ? C.rockShade : C.rock);
    rect(c, cx - half, y, 1, 1, C.outline);
    rect(c, cx + half - 1, y, 1, 1, C.outline);
  }
  rect(c, x0 + 14 - 6, FLOOR - h - 1, 12, 1, C.outline);
  // Erzbrocken im Stein
  const nug: [number, number][] = [
    [6, 5],
    [14, 9],
    [19, 4],
    [10, 13],
    [21, 11],
    [16, 15],
  ];
  for (const [nx, ny] of nug) {
    if (ny >= h - 1) continue;
    rect(c, x0 + nx, FLOOR - 1 - ny, 3, 2, ore.ore);
    rect(c, x0 + nx, FLOOR - 1 - ny, 1, 1, ore.oreHi);
  }
}

function drawCart(c: Ctx, rarity: MineRarity, fill: number, bounce: number) {
  const ore = ORE[rarity];
  const x = CART_X;
  const y = FLOOR - 9 - Math.round(bounce);
  // Ladung (füllt sich mit dem Lager)
  if (fill > 0) {
    const ph = Math.round(1 + fill * 6);
    for (let i = 0; i < ph; i++) {
      const w = 16 - Math.max(0, i - ph + 4) * 2;
      const xx = x + 2 + (16 - w) / 2;
      rect(c, xx, y - i, w, 1, i % 2 ? ore.ore : ore.oreHi);
    }
    if (fill >= 1) for (let i = 0; i < 4; i++) rect(c, x + 3 + i * 4, y - ph - 1, 2, 1, ore.oreHi);
  }
  // Wanne
  rect(c, x, y, 20, 7, C.metalShade);
  rect(c, x + 1, y + 1, 18, 5, '#4b5159');
  rect(c, x, y, 20, 1, C.metal);
  rect(c, x + 4, y + 2, 1, 4, C.metalShade);
  rect(c, x + 15, y + 2, 1, 4, C.metalShade);
  // Räder
  for (const wx of [x + 3, x + 13]) {
    rect(c, wx, FLOOR - 2, 4, 3, '#222');
    rect(c, wx + 1, FLOOR - 1, 2, 1, C.metal);
  }
}

// ---------- Szene ----------

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  col: string;
  grav: number;
}

interface Chunk {
  t: number;
  dur: number;
  col: string;
  hi: string;
  big: boolean;
}

export interface MineFrame {
  progress: number; // 0..1 im laufenden Durchgang
  status: MineStatus;
  fill: number; // Lager 0..1
}

export class MineScene {
  readonly canvas: HTMLCanvasElement;
  private ctx: Ctx;
  private low: HTMLCanvasElement;
  private lc: Ctx;
  private backdrop: HTMLCanvasElement;
  private sheet: CanvasImageSource | null = null;
  private particles: Particle[] = [];
  private chunks: Chunk[] = [];
  private shake = 0;
  private cartBounce = 0;
  private lastPhase = 0;
  private lastProgress = 0;
  private time = 0;
  private scale = 3;
  private W = MW;
  private ox = 0; // Versatz des Inhalts, damit er in breiten Szenen mittig steht
  private rng = mulberry32(Date.now() >>> 0);
  /** Wird beim Aufprall der Hacke gerufen (für einen leisen Klang). */
  onStrike?: () => void;

  constructor(private rarity: MineRarity) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'mine-canvas';
    this.ctx = this.canvas.getContext('2d')!;
    this.low = document.createElement('canvas');
    this.lc = this.low.getContext('2d')!;
    this.backdrop = drawBackdrop(rarity, MW, 0);
    void loadMinerSheet().then((s) => (this.sheet = s));
    this.fit(MW * 4);
  }

  /** Ganzzahlig auf die verfügbare Breite skalieren. */
  fit(width: number) {
    const s = Math.max(1, Math.min(6, Math.floor(width / MW)));
    const W = Math.max(MW, Math.floor(width / s));
    if (s === this.scale && W === this.W && this.low.width) return;
    this.scale = s;
    this.W = W;
    this.ox = Math.floor((W - MW) / 2);
    this.low.width = W;
    this.low.height = MH;
    this.backdrop = drawBackdrop(this.rarity, W, this.ox);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = W * s * dpr;
    this.canvas.height = MH * s * dpr;
    this.canvas.style.width = `${W * s}px`;
    this.canvas.style.height = `${MH * s}px`;
  }

  /** Ein Durchgang ist fertig: Brocken fliegt in die Lore. */
  burst(drops: LootEntry[], rareCol: string | null) {
    const ore = ORE[this.rarity];
    this.chunks.push({ t: 0, dur: 0.55, col: rareCol ?? ore.ore, hi: rareCol ? '#ffffff' : ore.oreHi, big: !!rareCol });
    void drops;
  }

  /** Position eines Punktes der Szene in CSS-Pixeln (für Einblendungen über dem Bild). */
  toCss(x: number, y: number): [number, number] {
    return [(x + this.ox) * this.scale, y * this.scale];
  }
  get cartTop(): [number, number] {
    return this.toCss(CART_X + 10, FLOOR - 14);
  }

  step(dt: number, f: MineFrame) {
    this.time += dt;
    // Takt des Arbeiters aus dem Fortschritt; neuer Durchgang = Phase springt zurück
    const phase = (f.progress * SWINGS_PER_RUN) % 1;
    const running = f.status === 'running';
    if (running && f.progress >= this.lastProgress && this.lastPhase < IMPACT && phase >= IMPACT) this.impact();
    this.lastPhase = phase;
    this.lastProgress = f.progress;

    for (const p of this.particles) {
      p.life -= dt;
      p.vy += p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.y > FLOOR && p.grav > 0) {
        p.y = FLOOR;
        p.vy *= -0.3;
        p.vx *= 0.5;
      }
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const ch of this.chunks) {
      ch.t += dt;
      if (ch.t >= ch.dur && ch.t - dt < ch.dur) {
        this.cartBounce = 2;
        for (let i = 0; i < 6; i++) this.spark(CART_X + 10, FLOOR - 12, ch.hi, 30, 0.4, 120);
      }
    }
    this.chunks = this.chunks.filter((c) => c.t < c.dur);
    this.shake = Math.max(0, this.shake - dt * 6);
    this.cartBounce = Math.max(0, this.cartBounce - dt * 10);
  }

  private spark(x: number, y: number, col: string, speed: number, life: number, grav: number) {
    const a = this.rng() * Math.PI * 2;
    const s = speed * (0.4 + this.rng() * 0.8);
    this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - speed * 0.6, life, max: life, col, grav });
  }

  private impact() {
    const ore = ORE[this.rarity];
    const x = ROCK_X + 3;
    const y = FLOOR - 10;
    this.shake = 1;
    for (let i = 0; i < 5; i++) this.spark(x, y, i % 2 ? '#ffe9a0' : '#fff', 55, 0.25, 40);
    for (let i = 0; i < 4; i++) this.spark(x + 2, y, i % 2 ? ore.ore : C.rockHi, 35, 0.6, 160);
    this.onStrike?.();
  }

  draw(f: MineFrame) {
    const c = this.lc;
    c.imageSmoothingEnabled = false;
    c.drawImage(this.backdrop, 0, 0);
    c.save();
    c.translate(this.ox, 0);
    const worn = f.status === 'worn';
    const sx = this.shake > 0 ? Math.round((this.rng() - 0.5) * 2 * this.shake) : 0;
    drawRock(c, this.rarity, ROCK_X + sx, worn ? 1 : f.progress);
    drawCart(c, this.rarity, f.fill, this.cartBounce);

    // Arbeiter
    if (this.sheet && !worn) {
      let a = MINER.anims.idle;
      let frame = Math.floor(this.time * a.fps) % a.frames;
      if (f.status === 'running') {
        a = MINER.anims.swing;
        frame = swingFrame(a, (f.progress * SWINGS_PER_RUN) % 1);
      } else if (f.status === 'full') {
        a = MINER.anims.rest;
        frame = Math.floor(this.time * a.fps) % a.frames;
      }
      c.drawImage(this.sheet, frame * MINER.frameW, a.row * MINER.frameH, MINER.frameW, MINER.frameH, WORKER_X - MINER.anchorX, FLOOR - MINER.anchorY, MINER.frameW, MINER.frameH);
      if (f.status === 'full') {
        // Zzz
        for (let i = 0; i < 3; i++) {
          const k = (this.time * 0.6 + i / 3) % 1;
          const zx = WORKER_X + 6 + k * 8;
          const zy = FLOOR - 24 - k * 14;
          c.globalAlpha = 1 - k;
          rect(c, zx, zy, 3, 1, '#e6ecf1');
          rect(c, zx + 1, zy + 1, 1, 1, '#e6ecf1');
          rect(c, zx, zy + 2, 3, 1, '#e6ecf1');
          c.globalAlpha = 1;
        }
      }
    }

    // Brocken im Flug
    for (const ch of this.chunks) {
      const k = Math.min(1, ch.t / ch.dur);
      const x0 = ROCK_X + 14;
      const y0 = FLOOR - 16;
      const x1 = CART_X + 10;
      const y1 = FLOOR - 12;
      const x = x0 + (x1 - x0) * k;
      const y = y0 + (y1 - y0) * k - Math.sin(k * Math.PI) * 18;
      const s = ch.big ? 4 : 3;
      rect(c, x - 1, y - 1, s, s, ch.col);
      rect(c, x - 1, y - 1, 1, 1, ch.hi);
      if (ch.big) {
        c.globalAlpha = 0.5;
        rect(c, x - 2, y - 2, s + 2, s + 2, ch.hi);
        c.globalAlpha = 1;
      }
    }
    for (const p of this.particles) {
      c.globalAlpha = Math.max(0, p.life / p.max);
      rect(c, p.x, p.y, 1, 1, p.col);
    }
    c.globalAlpha = 1;
    c.restore();
    const ox = this.ox;
    const W = this.W;

    // Licht der Laterne und der Helmlampe, Rest dunkler
    const flick = 0.9 + Math.sin(this.time * 9) * 0.04 + Math.sin(this.time * 23) * 0.03;
    c.save();
    c.globalCompositeOperation = 'multiply';
    const g = c.createRadialGradient(ox + 30, 20, 4, ox + 44, 30, 85 * flick);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.5, '#b8a088');
    g.addColorStop(1, '#3a2e28');
    c.fillStyle = g;
    c.fillRect(0, 0, W, MH);
    c.restore();
    const glow = ORE[this.rarity].glow;
    if (glow && !worn) {
      c.save();
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = 0.18 + Math.sin(this.time * 2) * 0.06;
      const gg = c.createRadialGradient(ox + ROCK_X + 14, FLOOR - 8, 1, ox + ROCK_X + 14, FLOOR - 8, 22);
      gg.addColorStop(0, glow);
      gg.addColorStop(1, 'transparent');
      c.fillStyle = gg;
      c.fillRect(0, 0, W, MH);
      c.restore();
    }
    if (worn) {
      // Bretter vor dem Stollen
      c.globalAlpha = 0.55;
      rect(c, 0, 0, W, MH, '#000');
      c.globalAlpha = 1;
      for (const [y, tilt] of [
        [22, 3],
        [36, -4],
        [48, 2],
      ] as const) {
        line(c, 6, y, W - 6, y + tilt, C.wood, 3);
        line(c, 6, y + 2, W - 6, y + tilt + 2, C.woodShade, 1);
      }
    }

    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.low, 0, 0, this.canvas.width, this.canvas.height);
  }
}
