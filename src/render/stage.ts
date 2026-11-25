// Das Kolosseum als Pixel-Hintergrund: Ränge mit Publikum links und rechts, Loge des Besitzers in der Mitte,
// Mauer mit Bannern, Sandboden. Alles in der niedrigen Auflösung W×H, wird ganzzahlig hochskaliert.

import { mulberry32 } from '../sim/rng';

export const W = 256;
export const H = 144;
export const FLOOR_Y = 46; // ab hier Sand
export const FIGHT_Y = 104; // Fußlinie der Kämpfer

export interface Seat {
  x: number;
  y: number;
  skin: string;
  cloth: string;
  phase: number;
}

const SKINS = ['#e0b083', '#c98e5a', '#a86a3c', '#7d4a28', '#ecc59b'];
const CLOTHES = ['#8b3a2e', '#3c5f8f', '#6b6b3a', '#7a5a8f', '#a8834a', '#2f6b5a', '#9a9a9a', '#5a3a2a', '#b85a3a'];

const ROWS = [9, 17, 25, 33];

/** Alle Sitzplätze. Wer im Publikum sitzt, wird per Seed auf die Plätze verteilt. */
export function seats(): Seat[] {
  const rng = mulberry32(12345);
  const out: Seat[] = [];
  for (const [ri, y] of ROWS.entries()) {
    const off = ri % 2 ? 2 : 0;
    for (const [x0, x1] of [
      [5, 104],
      [152, 251],
    ]) {
      for (let x = x0 + off; x <= x1 - 3; x += 5) {
        out.push({
          x,
          y,
          skin: SKINS[Math.floor(rng() * SKINS.length)],
          cloth: CLOTHES[Math.floor(rng() * CLOTHES.length)],
          phase: rng() * Math.PI * 2,
        });
      }
    }
  }
  return out;
}

/** Ordnet Zuschauer Nummer n einem Sitzplatz zu: gemischt, damit leere Plätze verteilt sind. */
export function seatOrder(count: number, seed: number): number[] {
  const rng = mulberry32(seed);
  const idx = Array.from({ length: count }, (_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}

function r(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, col: string) {
  c.fillStyle = col;
  c.fillRect(x, y, w, h);
}

export function drawBackdrop(team: [string, string]): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d')!;
  const rng = mulberry32(777);

  // Ränge: Stein mit Sitzstufen
  r(c, 0, 0, W, FLOOR_Y, '#4a3b2c');
  for (const y of ROWS) {
    r(c, 0, y + 4, W, 2, '#6b5640');
    r(c, 0, y + 6, W, 1, '#2e241a');
  }
  for (let i = 0; i < 400; i++) r(c, Math.floor(rng() * W), Math.floor(rng() * 40), 1, 1, rng() < 0.5 ? '#3d3024' : '#57473a');
  // Säulen zwischen den Blöcken
  for (const x of [0, 104, 146, 250]) {
    r(c, x, 0, 6, 40, '#7d6a52');
    r(c, x + 1, 0, 1, 40, '#9b876b');
    r(c, x + 5, 0, 1, 40, '#4f4132');
  }

  // Loge des Besitzers
  const lx = 110;
  const lw = 36;
  r(c, lx, 6, lw, 34, '#2a1d14');
  r(c, lx - 2, 4, lw + 4, 3, '#e2b44d');
  for (let i = 0; i < lw + 4; i += 4) r(c, lx - 2 + i, 7, 2, 4, i % 8 ? '#6b2a7a' : '#e2b44d');
  r(c, lx - 2, 11, lw + 4, 1, '#8a6a1c');
  r(c, lx, 30, lw, 10, '#6b2a7a');
  r(c, lx, 30, lw, 1, '#e2b44d');
  r(c, lx + 16, 31, 4, 8, '#e2b44d');
  // Thron und Besitzer (Platzhalter)
  r(c, lx + 14, 16, 8, 14, '#8a6a1c');
  r(c, lx + 15, 17, 6, 12, '#5b1f6e');
  r(c, lx + 16, 19, 4, 4, '#e0b083');
  r(c, lx + 16, 18, 4, 1, '#e2b44d');
  r(c, lx + 15, 23, 6, 7, '#efe4d2');
  r(c, lx + 15, 25, 6, 1, '#b8432f');
  // Wachen links und rechts in der Loge
  for (const gx of [lx + 4, lx + 28]) {
    r(c, gx, 19, 3, 3, '#c98e5a');
    r(c, gx - 1, 18, 5, 2, '#b9c0c8');
    r(c, gx, 22, 3, 8, '#7c2219');
    r(c, gx + 3, 14, 1, 16, '#8a5a32');
  }

  // Arena-Mauer
  r(c, 0, 40, W, FLOOR_Y - 40, '#7d6a52');
  for (let x = 0; x < W; x += 8) {
    r(c, x, 40, 1, FLOOR_Y - 40, '#5e4f3d');
  }
  r(c, 0, 40, W, 1, '#a08a6d');
  r(c, 0, FLOOR_Y - 1, W, 1, '#3a2e22');
  // Banner in Teamfarben
  for (const [bx, col] of [
    [30, team[0]],
    [70, team[0]],
    [182, team[1]],
    [222, team[1]],
  ] as [number, string][]) {
    r(c, bx, 40, 6, 9, col);
    r(c, bx, 49, 2, 1, col);
    r(c, bx + 4, 49, 2, 1, col);
    r(c, bx + 2, 43, 2, 2, '#e2b44d');
  }

  // Sandboden mit Körnung
  r(c, 0, FLOOR_Y, W, H - FLOOR_Y, '#c9a36a');
  for (let i = 0; i < 2600; i++) {
    const x = Math.floor(rng() * W);
    const y = FLOOR_Y + Math.floor(rng() * (H - FLOOR_Y));
    r(c, x, y, 1, 1, rng() < 0.5 ? '#b8915a' : '#d6b37c');
  }
  // Kampfkreis
  c.strokeStyle = 'rgba(120, 85, 45, 0.35)';
  c.lineWidth = 1;
  c.beginPath();
  c.ellipse(128, FIGHT_Y - 4, 92, 28, 0, 0, Math.PI * 2);
  c.stroke();
  // Schatten der Mauer und Rand-Vignette
  const g = c.createLinearGradient(0, FLOOR_Y, 0, FLOOR_Y + 14);
  g.addColorStop(0, 'rgba(40,25,10,0.45)');
  g.addColorStop(1, 'rgba(40,25,10,0)');
  c.fillStyle = g;
  c.fillRect(0, FLOOR_Y, W, 14);
  const v = c.createRadialGradient(128, 96, 60, 128, 96, 170);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.45)');
  c.fillStyle = v;
  c.fillRect(0, FLOOR_Y, W, H - FLOOR_Y);
  return cv;
}

/** Fackeln an der Mauer, flackern. */
export function drawTorches(c: CanvasRenderingContext2D, t: number) {
  for (const x of [50, 96, 160, 206]) {
    r(c, x, 42, 2, 5, '#4f2f1c');
    const f = Math.sin(t * 17 + x) > 0 ? 1 : 0;
    r(c, x - 1, 39 - f, 4, 3, '#e2701e');
    r(c, x, 38 - f, 2, 2, '#ffd04d');
    c.fillStyle = 'rgba(255,170,60,0.10)';
    c.fillRect(x - 5, 35, 12, 14);
  }
}
