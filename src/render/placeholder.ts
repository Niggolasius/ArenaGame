// Platzhalter-Grafik: zeichnet für jeden Kampfstil ein Sprite-Sheet im Raster aus sprites.ts.
// Nur damit der Prototyp lebt. Wird später durch Asset-Packs oder eigene Grafik ersetzt.
// Stil-Regeln, die auch für echte Grafik gelten sollten: 32×32, Licht von oben links,
// eine dunkle Kontur von 1 Pixel, gemeinsame Palette.

import type { Style } from '../sim/types';
import type { SpriteDef } from './sprites';

export interface TeamColors {
  main: string;
  dark: string;
}

const C = {
  outline: '#1a1210',
  skin: '#d9a066',
  skinShade: '#a86a3c',
  metal: '#b9c0c8',
  metalShade: '#6f7780',
  metalHi: '#eef3f6',
  leather: '#7a4a2a',
  leatherShade: '#4f2f1c',
  wood: '#8a5a32',
  woodShade: '#5e3b1f',
  gold: '#e2b44d',
  eye: '#2a1a12',
  stump: '#7d0f0f',
  stumpHi: '#c22a2a',
};

interface Pose {
  by: number; // Körper nach unten (Atmen, Knien)
  lean: number; // Oberkörper nach vorn
  legs: [number, number]; // Versatz hinteres / vorderes Bein
  lift: [number, number]; // Bein angehoben
  kneel: boolean;
  angle: number; // Waffenarm in Grad: 0 = nach vorn, -90 = nach oben, 90 = nach unten
  reach: number; // Hand nach vorn
  backAngle: number; // hinterer Arm
  headDy: number;
  noHead: boolean;
  noWeapon: boolean;
  onlyHead: boolean;
}

const BASE: Pose = {
  by: 0,
  lean: 0,
  legs: [0, 0],
  lift: [0, 0],
  kneel: false,
  angle: 0,
  reach: 0,
  backAngle: 60,
  headDy: 0,
  noHead: false,
  noWeapon: false,
  onlyHead: false,
};

const P = (p: Partial<Pose>): Pose => ({ ...BASE, ...p });

type Ctx = CanvasRenderingContext2D;

function rect(c: Ctx, x: number, y: number, w: number, h: number, col: string) {
  c.fillStyle = col;
  c.fillRect(Math.round(x), Math.round(y), w, h);
}

/** Linie Pixel für Pixel (Bresenham), mit Dicke 1 oder 2. */
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
  for (let i = 0; i < 64; i++) {
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

function drawHead(c: Ctx, style: Style, team: TeamColors, x: number, y: number) {
  // Kopf 6×6, Gesicht nach rechts
  rect(c, x, y, 6, 6, C.skin);
  rect(c, x, y + 4, 6, 2, C.skinShade);
  rect(c, x + 4, y + 3, 1, 1, C.eye);
  if (style === 'heavy') {
    // geschlossener Helm mit Sehschlitz und Querkamm
    rect(c, x - 1, y - 1, 7, 6, C.metal);
    rect(c, x - 1, y + 3, 7, 3, C.metalShade);
    rect(c, x + 3, y + 2, 3, 1, C.eye);
    rect(c, x, y - 1, 3, 1, C.metalHi);
    rect(c, x - 2, y - 3, 8, 2, team.main);
    rect(c, x - 2, y - 2, 8, 1, team.dark);
  } else if (style === 'swift') {
    // Kapuze / Stirnband, Gesicht frei
    rect(c, x - 1, y - 1, 7, 3, team.dark);
    rect(c, x - 1, y - 1, 7, 1, team.main);
    rect(c, x - 1, y + 2, 2, 3, team.dark);
    rect(c, x - 3, y + 1, 2, 1, team.main); // flatterndes Band
    rect(c, x - 4, y + 2, 1, 1, team.main);
  } else {
    // Helm mit hohem Kamm, Wangenschutz
    rect(c, x - 1, y - 1, 7, 3, C.metal);
    rect(c, x, y - 1, 3, 1, C.metalHi);
    rect(c, x - 1, y + 2, 2, 3, C.metalShade);
    rect(c, x + 1, y - 4, 4, 3, team.main);
    rect(c, x + 1, y - 2, 4, 1, team.dark);
  }
}

function drawWeapon(c: Ctx, style: Style, hx: number, hy: number, angle: number, back = false) {
  const dx = Math.cos(rad(angle));
  const dy = Math.sin(rad(angle));
  if (style === 'heavy') {
    // Zweihand-Axt: Stiel nach vorn und hinten über die Hand hinaus
    const len = 10;
    line(c, hx - dx * 3, hy - dy * 3, hx + dx * len, hy + dy * len, C.wood);
    line(c, hx - dx * 3 + 1, hy - dy * 3, hx + dx * len + 1, hy + dy * len, C.woodShade);
    // Klinge quer zum Stiel
    const ex = hx + dx * (len - 1);
    const ey = hy + dy * (len - 1);
    const px = -dy;
    const py = dx;
    for (let s = -3; s <= 3; s++) {
      const w = 3 - Math.abs(s) * 0.4;
      line(c, ex + px * s, ey + py * s, ex + px * s + dx * w, ey + py * s + dy * w, Math.abs(s) === 3 ? C.metalHi : C.metal);
    }
    line(c, ex + px * -3, ey + py * -3, ex + px * 3, ey + py * 3, C.metalShade);
  } else if (style === 'swift') {
    const len = back ? 4 : 5;
    line(c, hx + dx, hy + dy, hx + dx * (len + 1), hy + dy * (len + 1), C.metalHi);
    line(c, hx - dy, hy + dx, hx + dy, hy - dx, C.gold); // Parierstange
  } else {
    const len = 6;
    line(c, hx - dx * 12, hy - dy * 12, hx + dx * len, hy + dy * len, C.wood);
    line(c, hx + dx * len, hy + dy * len, hx + dx * (len + 3), hy + dy * (len + 3), C.metalHi);
    line(c, hx + dx * len - dy, hy + dy * len + dx, hx + dx * len + dy, hy + dy * len - dx, C.metal);
  }
}

function figure(c: Ctx, style: Style, team: TeamColors, p: Pose) {
  const by = p.by;
  const lx = p.lean;
  if (p.onlyHead) {
    drawHead(c, style, team, 13, 14);
    return;
  }
  // hinterer Arm (und was er hält)
  const bsx = 13 + lx;
  const bsy = 16 + by;
  const bhx = bsx + Math.cos(rad(p.backAngle)) * 4;
  const bhy = bsy + Math.sin(rad(p.backAngle)) * 4;
  if (style === 'spear' && !p.noWeapon) {
    // Rundschild auf dem Rücken
    rect(c, bsx - 4, bsy - 2, 6, 9, team.dark);
    rect(c, bsx - 3, bsy - 1, 4, 7, team.main);
    rect(c, bsx - 2, bsy + 2, 2, 2, C.gold);
  }
  line(c, bsx, bsy, bhx, bhy, C.skinShade, 2);
  if (style === 'swift' && !p.noWeapon) drawWeapon(c, style, bhx, bhy, p.backAngle - 40, true);

  // Beine
  if (p.kneel) {
    // hinteres Knie am Boden, vorderes Bein aufgestellt
    rect(c, 11, 27, 5, 2, C.skinShade);
    rect(c, 10, 29, 3, 1, C.leatherShade);
    rect(c, 16, 25 + Math.max(0, by - 5), 4, 2, C.skin);
    rect(c, 18, 26, 2, 3, C.skin);
    rect(c, 18, 29, 3, 1, C.leather);
  } else {
    const legY = 24;
    const leg = (x: number, lift: number, col: string, foot: string) => {
      rect(c, x, legY - lift, 2, 5, col);
      rect(c, x - 1 + 1, 29 - lift, 3, 1, foot);
      if (style === 'heavy') rect(c, x, legY + 2 - lift, 2, 3, C.metalShade);
    };
    leg(13 + p.legs[0], p.lift[0], C.skinShade, C.leatherShade);
    leg(16 + p.legs[1], p.lift[1], C.skin, C.leather);
  }

  // Rumpf
  const tx = 12 + lx;
  const ty = 15 + by;
  rect(c, tx, ty, 8, 7, team.main);
  rect(c, tx, ty + 5, 8, 2, team.dark);
  if (style === 'heavy') {
    rect(c, tx, ty, 8, 5, C.metal);
    rect(c, tx, ty + 3, 8, 2, C.metalShade);
    rect(c, tx + 1, ty, 3, 1, C.metalHi);
    rect(c, tx - 1, ty - 1, 4, 3, C.metal); // Schulterpanzer
    rect(c, tx - 1, ty + 1, 4, 1, C.metalShade);
  } else if (style === 'swift') {
    rect(c, tx + 1, ty, 6, 5, C.leather);
    rect(c, tx + 1, ty + 3, 6, 2, C.leatherShade);
    line(c, tx + 1, ty, tx + 6, ty + 5, team.main);
  } else {
    rect(c, tx + 1, ty, 6, 4, C.metal);
    rect(c, tx + 1, ty + 3, 6, 1, C.metalShade);
    rect(c, tx + 2, ty, 2, 1, C.metalHi);
  }
  // Gürtel und Lederstreifen
  rect(c, tx, ty + 6, 8, 1, C.leather);
  rect(c, tx + 5, ty + 6, 1, 1, C.gold);
  for (let i = 0; i < 4; i++) rect(c, tx + i * 2, ty + 7, 1, 2, i % 2 ? team.dark : C.leather);

  // Kopf mit Hals
  if (!p.noHead) {
    rect(c, tx + 3, ty - 1, 2, 1, C.skinShade);
    drawHead(c, style, team, tx + 1, ty - 7 + p.headDy);
  } else {
    rect(c, tx + 2, ty - 1, 4, 1, C.stump);
    rect(c, tx + 3, ty - 1, 2, 1, C.stumpHi);
  }

  // vorderer Arm mit Waffe
  const sx = 18 + lx;
  const sy = 16 + by;
  const hx = sx + Math.cos(rad(p.angle)) * 4 + p.reach;
  const hy = sy + Math.sin(rad(p.angle)) * 4;
  if (!p.noWeapon) drawWeapon(c, style, hx, hy, p.angle);
  line(c, sx, sy, hx, hy, C.skin, 2);
  rect(c, hx, hy, 2, 2, C.skin);
}

/** Pro Stil: Ruhehaltung der Waffe und die Angriffsbewegung. */
const STYLE_POSES: Record<Style, { rest: number; attack: Partial<Pose>[] }> = {
  heavy: {
    rest: -55,
    attack: [
      { angle: -80, lean: -1 },
      { angle: -120, lean: -2, by: 1 },
      { angle: -60, lean: 0 },
      { angle: 35, lean: 3, by: 1 },
      { angle: 55, lean: 2, by: 1 },
      { angle: -10, lean: 0 },
    ],
  },
  swift: {
    rest: 15,
    attack: [
      { angle: 10, lean: 0, backAngle: 30 },
      { angle: -15, lean: -1, reach: -2, backAngle: 20 },
      { angle: 0, lean: 2, reach: 1, backAngle: 50 },
      { angle: 0, lean: 4, reach: 4, backAngle: 60 },
      { angle: 10, lean: 3, reach: 1, backAngle: -5 },
      { angle: 15, lean: 1, backAngle: 40 },
    ],
  },
  spear: {
    rest: -12,
    attack: [
      { angle: -10, lean: -1, reach: -3 },
      { angle: -8, lean: -2, reach: -5 },
      { angle: -4, lean: 0, reach: -1 },
      { angle: 0, lean: 2, reach: 2 },
      { angle: -2, lean: 1, reach: 1 },
      { angle: -8, lean: 0, reach: -1 },
    ],
  },
};

function posesFor(style: Style): Pose[][] {
  const sp = STYLE_POSES[style];
  const rest = sp.rest;
  const idle = [0, 0, 1, 1].map((by, i) => P({ by, angle: rest + (i > 1 ? 4 : 0), headDy: by ? 0 : 0 }));
  const walkLegs: [number, number, number, number][] = [
    [-2, 2, 0, 0],
    [-1, 1, 0, 1],
    [0, 0, 1, 0],
    [2, -2, 0, 0],
    [1, -1, 1, 0],
    [0, 0, 0, 1],
  ];
  const walk = walkLegs.map(([a, b, la, lb], i) =>
    P({ legs: [a, b], lift: [la, lb], by: i % 3 === 2 ? -1 : 0, angle: rest + (i % 2 ? 5 : 0) }),
  );
  const attack = sp.attack.map((a) => P({ ...a, legs: [-1, 2] }));
  const hit = [P({ lean: -2, angle: rest - 20, headDy: -1, legs: [-1, 1] }), P({ lean: -3, angle: rest - 30, headDy: -1, by: 1, legs: [-2, 1] }), P({ lean: -1, angle: rest - 10 })];
  const kneel = P({ kneel: true, by: 5, lean: 1, headDy: 1, angle: 70, backAngle: 80 });
  const death = [P({ lean: -2, angle: rest - 20, headDy: -1 }), P({ by: 3, lean: -1, angle: 40, legs: [-1, 2], headDy: 1 }), kneel, kneel, kneel, kneel, kneel];
  const cheer = [P({ angle: -90, backAngle: 40 }), P({ angle: -95, by: -1, backAngle: 30 }), P({ angle: -88, backAngle: -60 }), P({ angle: -95, by: -1, backAngle: -70 })];
  const help = [P({ angle: 25, noWeapon: true, reach: 2, lean: 1 }), P({ angle: 30, noWeapon: true, reach: 3, lean: 2, by: 1 })];
  const head = [P({ onlyHead: true })];
  const deathHeadless = death.map((p) => ({ ...p, noHead: true }));
  return [idle, walk, attack, hit, death, cheer, help, head, deathHeadless];
}

/** Tod: ab Bild 3 kippt die kniende Figur nach hinten um und bleibt liegen. */
const DEATH_TILT = [0, 0, 0, 30, 62, 90, 90];
const DEATH_DY = [0, 0, 0, 0, 1, 1, 2];

function outline(ctx: Ctx, x0: number, y0: number, w: number, h: number) {
  const img = ctx.getImageData(x0, y0, w, h);
  const d = img.data;
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 0;
  const out: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (solid(x, y)) continue;
      if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) out.push(x, y);
    }
  ctx.fillStyle = C.outline;
  for (let i = 0; i < out.length; i += 2) ctx.fillRect(x0 + out[i], y0 + out[i + 1], 1, 1);
}

export function placeholderSheet(style: Style, team: TeamColors, def: SpriteDef): HTMLCanvasElement {
  const rows = posesFor(style);
  const cols = Math.max(...rows.map((r) => r.length));
  const fw = def.frameW;
  const fh = def.frameH;
  const sheet = document.createElement('canvas');
  sheet.width = cols * fw;
  sheet.height = rows.length * fh;
  const ctx = sheet.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  const tmp = document.createElement('canvas');
  tmp.width = fw;
  tmp.height = fh;
  const tc = tmp.getContext('2d')!;
  tc.imageSmoothingEnabled = false;

  rows.forEach((frames, r) => {
    const isDeath = r === 4 || r === 8;
    frames.forEach((pose, f) => {
      const x0 = f * fw;
      const y0 = r * fh;
      tc.clearRect(0, 0, fw, fh);
      figure(tc, style, team, pose);
      const tilt = isDeath ? DEATH_TILT[f] : 0;
      if (tilt) {
        // um den Knie-Punkt nach hinten kippen
        const px = 13;
        const py = 29;
        ctx.save();
        ctx.translate(x0 + px, y0 + py + (DEATH_DY[f] ?? 0) - Math.round(tilt / 45));
        ctx.rotate(-rad(tilt));
        ctx.drawImage(tmp, -px, -py);
        ctx.restore();
      } else {
        ctx.drawImage(tmp, x0, y0);
      }
      outline(ctx, x0, y0, fw, fh);
    });
  });
  return sheet;
}
