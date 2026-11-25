// Der Pixel-Kampf: spielt einen simulierten Kampf im Kolosseum ab, danach den Mercy-Moment
// mit Publikumsabstimmung, Bestechung, Entscheidung und Finisher.
// Die Welt wird in niedriger Auflösung (W×H) gezeichnet und ganzzahlig hochskaliert,
// Schrift (Schadenszahlen, Namen, Banner) danach scharf in voller Auflösung darüber.

import { simulate } from '../sim/combat';
import type { Config } from '../sim/config';
import { resolveMercy, setupMercy, tally, type MercyOutcome, type MercySetup } from '../sim/mercy';
import { formatMoney, formLabel, LAST_STAND_NAMES, MERCY_HINTS, MERCY_NAMES, UI, type MercyChoice } from '../sim/names';
import { mulberry32, type Rng } from '../sim/rng';
import type { FightEvent, FightResult, Gladiator, Style } from '../sim/types';
import { sfx, unlockAudio } from './audio';
import { placeholderSheet, type TeamColors } from './placeholder';
import { SPRITES, type AnimDef, type SpriteDef } from './sprites';
import { drawBackdrop, drawTorches, FIGHT_Y, FLOOR_Y, H, seatOrder, seats, W, type Seat } from './stage';
import { buildChoreo, frameAt, lastReaction, swingAt, windup, type Choreo } from './timeline';

export const TEAMS: [TeamColors, TeamColors] = [
  { main: '#c8402e', dark: '#7c2219' },
  { main: '#3f7fd0', dark: '#234c86' },
];
const TEAM_UI = ['#ff7a62', '#6fb2ee'];

type AnimKey = keyof SpriteDef['anims'];
type Phase = 'intro' | 'fight' | 'down' | 'vote' | 'choose' | 'finisher' | 'done';

export interface ArenaOptions {
  blood: boolean;
  speed: number;
  /** Bei einem Replay steht die Entscheidung schon fest. */
  choice?: MercyChoice;
  /** Bei einem Replay: Sekunden nach Beginn der Abstimmung, zu denen entschieden wurde. */
  choiceAt?: number;
  onDecision?: (choice: MercyChoice, outcome: MercyOutcome, at: number) => void;
  onReplay?: () => void;
  onNewFight?: () => void;
}

// ---------- Sprite-Sheets laden ----------

const sheetCache = new Map<string, Promise<CanvasImageSource>>();

export function loadSheet(style: Style, side: 0 | 1): Promise<CanvasImageSource> {
  const def = SPRITES[style];
  const key = def.src ? `src:${def.src}` : `ph:${style}:${side}`;
  let p = sheetCache.get(key);
  if (!p) {
    p = def.src
      ? new Promise((res) => {
          const img = new Image();
          img.onload = () => res(img);
          // Bild fehlt: Platzhalter statt leerer Arena
          img.onerror = () => res(placeholderSheet(style, TEAMS[side], def));
          img.src = `${import.meta.env.BASE_URL}${def.src}`;
        })
      : Promise.resolve(placeholderSheet(style, TEAMS[side], def));
    sheetCache.set(key, p);
  }
  return p;
}

function anim(def: SpriteDef, key: AnimKey): AnimDef {
  const a = def.anims[key];
  if (a) return a;
  if (key === 'deathHeadless') return def.anims.death;
  return def.anims.idle;
}
const kneelFrame = (a: AnimDef) => a.kneelFrame ?? 1;

// ---------- Kleinteile ----------

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  col: string;
  size: number;
  ground: number; // Bodenhöhe, dort bleibt Blut liegen
  blood: boolean;
}

interface Popup {
  x: number;
  y: number;
  text: string;
  col: string;
  size: number; // in Welt-Pixeln
  age: number;
  life: number;
  vy: number;
  font: 'pixel' | 'serif';
}

interface Slash {
  x: number;
  y: number;
  dir: number;
  age: number;
  life: number;
  big: boolean;
  col: string;
}

interface Banner {
  text: string;
  sub?: string;
  col: string;
  age: number;
  life: number;
  y: number; // Anteil der Höhe
  size: number;
}

class Fighter {
  x = 0;
  y = FIGHT_Y;
  ox = 0;
  oy = 0;
  anim: AnimKey = 'idle';
  animT = 0;
  frameOverride: number | null = null;
  flash = 0;
  hp: number;
  hpGhost: number;
  ghostDelay = 0;
  lastStand = false;
  hidden = false;
  face: 1 | -1;
  rot = 0; // Drehung beim Ausweichen (Rolle)
  constructor(
    public side: 0 | 1,
    public g: Gladiator,
    public def: SpriteDef,
    public sheet: CanvasImageSource,
    public maxHp: number,
  ) {
    this.hp = maxHp;
    this.hpGhost = maxHp;
    this.face = side === 0 ? 1 : -1;
  }
  get name() {
    return this.g.name || (this.side ? 'B' : 'A');
  }
}

// ---------- Die Ansicht ----------

export class ArenaView {
  readonly root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private low: HTMLCanvasElement;
  private lc: CanvasRenderingContext2D;
  private decals: HTMLCanvasElement;
  private dc: CanvasRenderingContext2D;
  private sprTmp: HTMLCanvasElement;
  private backdrop: HTMLCanvasElement;
  private ui: HTMLDivElement;
  private scale = 3;
  private dpr = 1;

  private result: FightResult;
  private events: FightEvent[];
  private choreo!: Choreo;
  private mercy: MercySetup;
  private outcome: MercyOutcome | null = null;
  private choice: MercyChoice | null = null;
  private f!: [Fighter, Fighter];
  private winner: 0 | 1;
  private loser: 0 | 1;
  private fx: Rng;

  private phase: Phase = 'intro';
  private phaseT = 0;
  private simT = -0.45;
  private evIdx = 0;
  private endT: number;
  private koT: number | null = null;
  private hitstop = 0;
  private slowmo = 1;
  private slowmoT = 0;
  private shake = 0;
  private flashA = 0;
  private dark = 0;
  private excite = 0.2;
  // Kamera: Zoom-Stoß bei Krits und Wuchttreffern, Heranfahren beim KO
  private camZoom = 1;
  private zoomKick = 0;
  private zoomHold = 1;
  private camX = W / 2;
  private camY = H / 2;
  private danger = 0;
  private beatT = 0;
  private footPhase = 0;
  private turbo = false;
  private time = 0;
  private voteSecond = -1;

  private particles: Particle[] = [];
  private popups: Popup[] = [];
  private slashes: Slash[] = [];
  private banners: Banner[] = [];
  private seats: Seat[] = seats();
  private seatOf: number[]; // Zuschauer n → Sitz
  private voted = new Map<number, boolean>(); // Sitz → Daumen hoch?

  // Finisher
  private head: { x: number; y: number; vx: number; vy: number; rot: number; vr: number; rest: boolean } | null = null;
  private purse: { x0: number; y0: number; x1: number; y1: number; t: number; dur: number; caught: boolean } | null = null;
  private spearThrough = 0;
  private fountain = 0;
  private fin: Record<string, number> = {};
  private finFired = new Set<string>();

  private raf = 0;
  private last = 0;
  private destroyed = false;
  private onResize = () => this.resize();

  constructor(
    private host: HTMLElement,
    private a: Gladiator,
    private b: Gladiator,
    seed: number,
    private cfg: Config,
    private opts: ArenaOptions,
  ) {
    this.result = simulate(a, b, seed, cfg, { events: true });
    this.events = this.result.events ?? [];
    this.endT = this.events.at(-1)?.t ?? this.result.seconds;
    this.winner = this.result.winner;
    this.loser = (1 - this.winner) as 0 | 1;
    this.mercy = setupMercy(a, b, this.result, seed, cfg);
    this.seatOf = seatOrder(this.seats.length, seed ^ 0x5eed);
    this.fx = mulberry32(seed ^ 0xbeef);
    this.footPhase = mulberry32(seed ^ 0xf00d)() * Math.PI * 2;

    this.root = document.createElement('div');
    this.root.className = 'arena-stage';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'arena-canvas';
    this.ctx = this.canvas.getContext('2d')!;
    this.ui = document.createElement('div');
    this.ui.className = 'arena-ui';
    this.root.append(this.canvas, this.ui);
    host.replaceChildren(this.root);

    this.low = document.createElement('canvas');
    this.low.width = W;
    this.low.height = H;
    this.lc = this.low.getContext('2d')!;
    this.lc.imageSmoothingEnabled = false;
    this.decals = document.createElement('canvas');
    this.decals.width = W;
    this.decals.height = H;
    this.dc = this.decals.getContext('2d')!;
    this.sprTmp = document.createElement('canvas');
    this.backdrop = drawBackdrop([TEAMS[0].main, TEAMS[1].main]);

    this.resize();
    window.addEventListener('resize', this.onResize);
  }

  async start() {
    const [sa, sb] = await Promise.all([loadSheet(this.a.style, 0), loadSheet(this.b.style, 1)]);
    if (this.destroyed) return;
    this.f = [
      new Fighter(0, this.a, SPRITES[this.a.style], sa, this.result.maxHp[0]),
      new Fighter(1, this.b, SPRITES[this.b.style], sb, this.result.maxHp[1]),
    ];
    const tmpW = Math.max(this.f[0].def.frameW, this.f[1].def.frameW);
    const tmpH = Math.max(this.f[0].def.frameH, this.f[1].def.frameH);
    this.sprTmp.width = tmpW;
    this.sprTmp.height = tmpH;
    this.choreo = buildChoreo(this.events, [this.f[0].def.anims.attack, this.f[1].def.anims.attack]);
    this.f[0].x = -20;
    this.f[1].x = W + 20;
    this.setPhase('intro');
    this.last = performance.now();
    const loop = (now: number) => {
      if (this.destroyed) return;
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.step(dt);
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
  }

  setSpeed(s: number) {
    this.opts.speed = s;
  }
  setBlood(b: boolean) {
    this.opts.blood = b;
  }
  /** Bis zum nächsten Abschnitt im Zeitraffer. */
  skip() {
    if (this.phase === 'choose' || this.phase === 'done') return;
    this.turbo = true;
  }
  getResult() {
    return this.result;
  }
  getMercy() {
    return this.mercy;
  }

  private resize() {
    const avail = Math.max(240, this.host.clientWidth || W * 3);
    this.scale = Math.max(1, Math.min(5, Math.floor(avail / W)));
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = Math.min(avail, W * this.scale);
    const u = this.scale * this.dpr;
    this.canvas.width = W * u;
    this.canvas.height = H * u;
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${(cssW * H) / W}px`;
    this.root.style.width = `${cssW}px`;
  }

  // ---------- Ablauf ----------

  private setPhase(p: Phase) {
    if (this.f) for (const x of this.f) x.rot = 0;
    this.phase = p;
    this.phaseT = 0;
    this.turbo = false;
    const [w, l] = [this.f[this.winner], this.f[this.loser]];
    if (p === 'intro') {
      this.f.forEach((x) => (x.anim = 'walk'));
    } else if (p === 'fight') {
      this.simT = -0.45;
    } else if (p === 'down') {
      this.addBanner(UI.victory, w.name, '#ffd77a', 0.36, 2.4, 22);
      sfx.crowd(1.2, 2.2);
      this.excite = 1;
    } else if (p === 'vote') {
      this.voteSecond = -1;
      this.renderMercyButtons();
    } else if (p === 'choose') {
      this.renderMercyButtons();
      if (this.opts.choice) {
        const c = this.opts.choice;
        window.setTimeout(() => this.decide(c, true), 500);
      }
    } else if (p === 'finisher') {
      this.ui.replaceChildren();
      this.planFinisher();
      w.anim = 'idle';
      l.anim = 'death';
    } else if (p === 'done') {
      this.renderSummary();
    }
  }

  private step(dtReal: number) {
    const speed = this.opts.speed * (this.turbo ? 6 : 1);
    let dt = dtReal * speed;
    this.time += dtReal;
    if (this.slowmoT > 0) {
      this.slowmoT -= dtReal;
      dt *= this.slowmo;
    }
    this.shake = Math.max(0, this.shake - dtReal * 18);
    this.stepCamera(dtReal);
    this.flashA = Math.max(0, this.flashA - dtReal * 3);
    if (this.hitstop > 0) {
      this.hitstop -= dtReal;
      return; // alles steht kurz still
    }
    this.phaseT += dt;
    this.excite = Math.max(0.15, this.excite - dt * 0.35);
    for (const x of this.f) {
      x.flash = Math.max(0, x.flash - dt);
      if (x.ghostDelay > 0) x.ghostDelay -= dt;
      else x.hpGhost = Math.max(x.hp, x.hpGhost - x.maxHp * dt * 0.8);
    }

    switch (this.phase) {
      case 'intro':
        this.stepIntro();
        break;
      case 'fight':
        this.stepFight(dt);
        break;
      case 'down':
        this.stepDown();
        break;
      case 'vote':
        this.stepVote();
        break;
      case 'choose':
        this.idleBoth(this.phaseT);
        this.holdKneel();
        break;
      case 'finisher':
        this.stepFinisher(dt);
        break;
      case 'done':
        this.stepAfter();
        break;
    }
    this.stepParticles(dt);
  }

  private basePos(): [number, number] {
    const far = this.a.orders.distance === 'far' || this.b.orders.distance === 'far';
    const gap = far ? 42 : 25;
    return [128 - gap / 2, 128 + gap / 2];
  }

  private stepIntro() {
    const t = this.phaseT;
    const start = this.footwork(-0.45);
    const k = Math.min(1, t / 1.5);
    const e = 1 - Math.pow(1 - k, 2);
    this.f.forEach((x, i) => {
      const from = i === 0 ? -20 : W + 20;
      x.x = from + (start[i].x - from) * e;
      x.y = FIGHT_Y + (start[i].y - FIGHT_Y) * e;
      x.anim = k < 1 ? 'walk' : 'idle';
      x.animT = t;
    });
    if (t > 0.5 && !this.fired('form')) {
      this.f.forEach((_x, i) => {
        const form = this.result.form[i];
        const pctTxt = `${form >= 1 ? '+' : '−'}${Math.round(Math.abs(form - 1) * 100)}%`;
        const col = form - 1 >= 0.15 ? '#7dff8a' : form - 1 <= -0.15 ? '#ff6b5a' : '#e9dcc4';
        this.banners.push({ text: pctTxt, sub: formLabel(form), col, age: 0, life: 1.45, y: 0.36, size: i === 0 ? -1 : -2 });
      });
    }
    if (t > 1.9 && !this.fired('fightText')) {
      this.addBanner(UI.fight, undefined, '#ffd04d', 0.4, 0.9, 30);
      sfx.horn();
      this.excite = 0.8;
    }
    if (t >= 2.6) this.setPhase('fight');
  }

  private stepFight(dt: number) {
    this.simT += dt;
    while (this.evIdx < this.events.length && this.events[this.evIdx].t <= this.simT) {
      this.trigger(this.events[this.evIdx++]);
    }
    const t = this.simT;
    const foot = this.footwork(t);
    const next = this.footwork(t + 0.06);
    this.f.forEach((x, i) => {
      x.x = foot[i].x;
      x.y = foot[i].y;
      x.ox = 0;
      x.oy = 0;
      x.rot = 0;
      x.frameOverride = null;
      const moving = Math.hypot(next[i].x - foot[i].x, next[i].y - foot[i].y) / 0.06 > 7;
      if (this.koT !== null && i === this.loser) {
        x.anim = 'death';
        x.animT = t - this.koT;
        x.frameOverride = Math.min(kneelFrame(x.def.anims.death), frameAt(x.def.anims.death, x.animT));
        return;
      }
      const sw = swingAt(this.choreo.swings[i], t);
      const re = lastReaction(this.choreo.reactions[i], t, 0.3);
      if (sw) {
        const a = x.def.anims.attack;
        const wind = windup(a);
        const ft = sw.frameTime;
        const lunge = { heavy: 11, swift: 14, spear: 9 }[x.g.style];
        const p = ft < wind ? Math.pow(ft / wind, 2) : Math.max(0, 1 - (ft - wind) / Math.max(0.01, a.frames / a.fps - wind));
        x.ox = lunge * p * x.face;
        x.anim = 'attack';
        x.animT = ft;
      } else if (re) {
        const age = t - re.t;
        if (re.kind === 'hit') {
          const kb = re.lucky ? 14 : re.crit ? 7 : 3.5;
          x.ox = -kb * (1 - age / 0.3) * x.face;
          x.anim = 'hit';
          x.animT = age;
        } else {
          // Ausweich-Rolle nach hinten
          const k = Math.min(1, age / 0.3);
          const s = Math.sin(Math.PI * k);
          x.ox = -12 * s * x.face;
          x.oy = -5 * s;
          x.rot = -x.face * Math.PI * 2 * k;
          x.anim = 'idle';
          x.animT = t;
        }
      } else {
        x.anim = moving ? 'walk' : 'idle';
        x.animT = t + i * 0.37;
      }
    });
    // Herzschlag, wenn einer fast tot ist
    const low = this.f.some((x) => x.hp > 0 && x.hp / x.maxHp < this.cfg.lastStand.threshold);
    this.danger = low && this.koT === null ? Math.min(1, this.danger + dt * 2) : Math.max(0, this.danger - dt * 2);
    if (this.danger > 0.5) {
      this.beatT -= dt;
      if (this.beatT <= 0) {
        this.beatT = 0.75;
        sfx.heartbeat();
      }
    }
    if (this.simT >= this.endT + 0.9) this.setPhase('down');
  }

  private trigger(e: FightEvent) {
    const f = this.f;
    switch (e.type) {
      case 'hit': {
        const att = f[e.from];
        const def = f[1 - e.from];
        def.hp = e.hpLeft;
        def.ghostDelay = 0.45;
        def.flash = 0.09;
        const hx = def.x - def.face * 4;
        const hy = def.y - 16;
        const col = e.lucky ? '#ff8a3d' : e.crit ? '#ffd04d' : '#ffffff';
        const size = e.lucky ? 13 : e.crit ? 11 : 8;
        this.popups.push({ x: def.x + (def.side === 0 ? -10 : 10) + (this.fx() * 6 - 3), y: def.y - 22, text: e.dmg.toLocaleString('en-US'), col, size, age: 0, life: e.lucky ? 1.3 : 0.95, vy: -22, font: 'pixel' });
        if (e.crit) this.popups.push({ x: def.x + (def.side === 0 ? -10 : 10), y: def.y - 31, text: UI.crit, col: '#ffd04d', size: 6, age: 0, life: 0.8, vy: -18, font: 'pixel' });
        this.slashes.push({ x: hx, y: hy, dir: att.face, age: 0, life: 0.16, big: e.crit || e.lucky, col: e.lucky ? '#ffb26b' : e.crit ? '#fff1a8' : '#ffffff' });
        this.burst(hx, hy, att.face, e.lucky ? 26 : e.crit ? 14 : 7, def.y);
        this.excite = Math.min(1, this.excite + (e.lucky ? 0.8 : e.crit ? 0.35 : 0.12));
        if (e.lucky) {
          this.hitstop = 0.16;
          this.shake = 6;
          this.flashA = 0.3;
          this.zoomKick = 0.22;
          this.addBanner(UI.crushingBlow, undefined, '#ff8a3d', 0.3, 1.2, 20);
          sfx.crushing();
        } else if (e.crit) {
          this.hitstop = 0.06;
          this.shake = 2.5;
          this.zoomKick = Math.max(this.zoomKick, 0.08);
          sfx.crit();
        } else {
          this.shake = Math.max(this.shake, 0.8);
          sfx.hit(0.7 + Math.min(0.6, e.dmg / def.maxHp));
        }
        if (e.hpLeft <= 0 && this.koT === null) this.knockout();
        break;
      }
      case 'dodge': {
        const def = f[1 - e.from];
        this.popups.push({ x: def.x, y: def.y - 32, text: UI.dodge, col: '#cfd6dd', size: 6, age: 0, life: 0.8, vy: -16, font: 'pixel' });
        sfx.dodge();
        break;
      }
      case 'heal': {
        const x = f[e.who];
        x.hp = e.hpLeft;
        x.hpGhost = Math.max(x.hpGhost, x.hp);
        this.popups.push({ x: x.x, y: x.y - 34, text: `+${e.amount}`, col: '#7dff8a', size: 7, age: 0, life: 0.9, vy: -14, font: 'pixel' });
        sfx.heal();
        break;
      }
      case 'thorns': {
        const x = f[e.who];
        x.hp = e.hpLeft;
        x.ghostDelay = 0.45;
        this.popups.push({ x: x.x, y: x.y - 26, text: `${e.dmg}`, col: '#d68cff', size: 7, age: 0, life: 0.9, vy: -18, font: 'pixel' });
        if (e.hpLeft <= 0 && this.koT === null) this.knockout();
        break;
      }
      case 'laststand': {
        const x = f[e.who];
        x.lastStand = true;
        const mode = x.g.orders.lastStand;
        this.popups.push({ x: x.x, y: x.y - 44, text: UI.lastStand, col: '#ff9f6b', size: 7, age: 0, life: 1.6, vy: -6, font: 'pixel' });
        if (mode !== 'normal') this.popups.push({ x: x.x, y: x.y - 36, text: LAST_STAND_NAMES[mode], col: '#ffd7b0', size: 5, age: 0, life: 1.6, vy: -6, font: 'pixel' });
        this.excite = 1;
        break;
      }
      case 'end': {
        if (e.reason === 'time') {
          this.addBanner(UI.timeUp, undefined, '#ffd04d', 0.3, 1.2, 24);
          this.knockout();
        }
        break;
      }
    }
  }

  private knockout() {
    this.koT = this.simT;
    this.zoomHold = 1.3;
    this.slowmo = 0.35;
    this.slowmoT = 0.7;
    this.excite = 1;
  }

  /**
   * Beinarbeit: Das Paar wandert durch die Arena, dreht sich etwas um seine Mitte
   * und geht abwechselnd auf Abstand und wieder heran. Rein optisch, ändert nichts am Kampf.
   */
  private footwork(t: number): { x: number; y: number }[] {
    const ph = this.footPhase;
    const base = this.basePos();
    const gap0 = base[1] - base[0];
    const gap = gap0 + 9 * (0.5 + 0.5 * Math.sin(t * 1.7 + ph));
    const cx = 128 + 18 * Math.sin(t * 0.43 + ph) + 6 * Math.sin(t * 1.21 + ph * 2);
    const cy = FIGHT_Y - 2 + 6 * Math.sin(t * 0.57 + ph * 3);
    const ang = 0.45 * Math.sin(t * 0.38 + ph * 1.7);
    const dx = (Math.cos(ang) * gap) / 2;
    const dy = Math.sin(ang) * gap * 0.35;
    return [
      { x: cx - dx, y: cy - dy },
      { x: cx + dx, y: cy + dy },
    ];
  }

  private stepCamera(dtReal: number) {
    this.zoomKick = Math.max(0, this.zoomKick - dtReal * 0.9);
    if (this.phase === 'vote' || this.phase === 'choose' || this.phase === 'done' || this.phase === 'intro') this.zoomHold = 1;
    const target = Math.max(1 + this.zoomKick, this.zoomHold);
    this.camZoom += (target - this.camZoom) * Math.min(1, dtReal * (target > this.camZoom ? 14 : 3));
    if (!this.f) return;
    const fx = (this.f[0].x + this.f[0].ox + this.f[1].x + this.f[1].ox) / 2;
    const fy = (this.f[0].y + this.f[1].y) / 2 - 16;
    const k = Math.min(1, dtReal * 6);
    this.camX += (fx - this.camX) * k;
    this.camY += (fy - this.camY) * k;
  }

  /** Ausschnitt der Welt, den die Kamera zeigt. */
  private view() {
    const z = this.camZoom;
    const vw = W / z;
    const vh = H / z;
    const x0 = Math.max(0, Math.min(W - vw, this.camX - vw / 2));
    const y0 = Math.max(0, Math.min(H - vh, this.camY - vh / 2));
    return { z, x0, y0, vw, vh };
  }

  private stepDown() {
    const l = this.f[this.loser];
    const w = this.f[this.winner];
    l.anim = 'death';
    l.animT = this.phaseT + 0.5;
    l.frameOverride = kneelFrame(l.def.anims.death);
    l.ox = l.oy = 0;
    w.ox = w.oy = 0;
    w.frameOverride = null;
    w.anim = this.phaseT > 0.4 ? 'cheer' : 'idle';
    w.animT = this.phaseT;
    if (this.phaseT >= 1.4) this.setPhase('vote');
  }

  private holdKneel() {
    const l = this.f[this.loser];
    l.anim = 'death';
    l.frameOverride = kneelFrame(l.def.anims.death);
  }

  private idleBoth(t: number) {
    for (const x of this.f) {
      x.anim = 'idle';
      x.animT = t + x.side * 0.4;
      x.ox = x.oy = 0;
      x.frameOverride = null;
    }
  }

  private stepVote() {
    const t = this.phaseT;
    this.idleBoth(t);
    this.holdKneel();
    this.dark = Math.min(0.25, t * 0.3);
    for (const v of this.mercy.votes) {
      if (v.t > t) break;
      const seat = this.seatOf[v.seat];
      if (seat !== undefined && !this.voted.has(seat)) {
        this.voted.set(seat, v.spare);
        if (this.fx() < 0.25) sfx.vote();
      }
    }
    const sec = Math.floor(t);
    if (sec !== this.voteSecond) {
      this.voteSecond = sec;
      if (sec > 0) sfx.tick();
      this.updateVoteButtons();
    }
    this.excite = 0.5;
    // Replay: Entscheidung zur selben Zeit wie beim ersten Ansehen
    if (this.opts.choice && this.opts.choiceAt !== undefined && t >= this.opts.choiceAt) {
      this.decide(this.opts.choice, true);
      return;
    }
    if (t >= this.mercy.voteSeconds) this.setPhase('choose');
  }

  /** Der Sieger darf schon während der Abstimmung entscheiden. Dann zählen nur die Stimmen bis jetzt. */
  decide(choice: MercyChoice, auto = false) {
    if ((this.phase !== 'choose' && this.phase !== 'vote') || this.choice) return;
    if (this.opts.choice && !auto) return;
    const at = this.phase === 'vote' ? this.phaseT : Infinity;
    this.choice = choice;
    this.outcome = resolveMercy(this.mercy, choice, this.cfg, at);
    this.opts.onDecision?.(choice, this.outcome, at);
    sfx.click();
    this.setPhase('finisher');
  }

  // ---------- Finisher ----------

  private fired(key: string) {
    if (this.finFired.has(key)) return true;
    this.finFired.add(key);
    return false;
  }

  private planFinisher() {
    const w = this.f[this.winner];
    const l = this.f[this.loser];
    const c = this.choice!;
    const style = w.g.style;
    const dist = c === 'kill' ? { heavy: 18, swift: 15, spear: 28 }[style] : c === 'honor' ? 13 : Math.abs(w.x - l.x);
    const targetX = l.x - w.face * dist;
    const walk = Math.max(0.15, Math.abs(targetX - w.x) / 45);
    const a = w.def.anims.attack;
    const rate = 0.55;
    const atk = walk + 0.45;
    const hit = atk + windup(a) / rate;
    const fall = c === 'kill' && style === 'spear' ? hit + 0.9 : hit + 0.05;
    this.fin = { startX: w.x, targetX, walk, rate, atk, hit, fall };
  }

  private stepFinisher(dt: number) {
    const t = this.phaseT;
    const c = this.choice!;
    const w = this.f[this.winner];
    const l = this.f[this.loser];
    const F = this.fin;
    const lDeath = l.def.anims.death;
    const kf = kneelFrame(lDeath);
    w.ox = w.oy = 0;
    l.ox = l.oy = 0;
    w.frameOverride = null;
    l.frameOverride = null;

    // Laufen zum Verlierer
    if (t < F.walk && c !== 'gold') {
      const k = t / F.walk;
      w.x = F.startX + (F.targetX - F.startX) * k;
      w.y += (l.y - w.y) * Math.min(1, k * 1.5);
      w.anim = 'walk';
      w.animT = t;
    } else if (c !== 'gold') {
      w.x = F.targetX;
    }

    if (c === 'kill') {
      this.dark = Math.min(0.62, this.dark + dt * 0.9);
      const style = w.g.style;
      if (t >= F.walk && t < F.atk) {
        w.anim = 'idle';
        w.animT = t;
      } else if (t >= F.atk) {
        const at = (t - F.atk) * F.rate;
        const a = w.def.anims.attack;
        if (at < a.frames / a.fps) {
          w.anim = 'attack';
          w.animT = at;
          // Speer bleibt im Ziel stecken, bis er herausgezogen wird
          if (style === 'spear' && t >= F.hit && t < F.fall) w.frameOverride = a.hitFrame ?? 3;
        } else {
          w.anim = t > F.fall + 0.9 ? 'cheer' : 'idle';
          w.animT = t;
        }
        if (style === 'spear' && t >= F.hit && t < F.fall) {
          w.anim = 'attack';
          w.frameOverride = a.hitFrame ?? 3;
        }
      }
      if (t >= F.hit && !this.fired('impact')) this.impact(style);
      // Verlierer
      if (t < F.hit) {
        l.anim = 'death';
        l.frameOverride = kf;
      } else if (t < F.fall) {
        if (style === 'spear') {
          // aufgespießt: Körper hochgerissen
          l.anim = 'hit';
          l.frameOverride = 1;
          l.oy = -3;
        } else {
          l.anim = 'death';
          l.frameOverride = kf;
          l.ox = w.face * 2;
        }
      } else {
        const headless = style === 'heavy' && this.opts.blood && !!l.def.head;
        const da = anim(l.def, headless ? 'deathHeadless' : 'death');
        l.anim = headless ? 'deathHeadless' : 'death';
        l.frameOverride = Math.min(da.frames - 1, kf + Math.floor((t - F.fall) * da.fps * 0.8));
      }
      this.spearThrough = style === 'spear' && t >= F.hit && t < F.fall ? 1 : 0;
      if (t >= F.fall + 0.6 && !this.fired('banner')) {
        this.addBanner(UI.executed, l.name, '#ff4a3a', 0.3, 2.4, 24);
        sfx.crowd(1.4, 2.6);
        this.excite = 1;
      }
      if (t >= F.fall + 3) this.setPhase('done');
    } else if (c === 'gold') {
      l.anim = 'death';
      l.frameOverride = kf;
      if (t >= 0.35 && !this.purse) {
        this.purse = { x0: l.x + l.face * 6, y0: l.y - 14, x1: w.x + w.face * 4, y1: w.y - 18, t: 0, dur: 0.8, caught: false };
      }
      if (this.purse) {
        this.purse.t += dt;
        if (this.purse.t >= this.purse.dur && !this.purse.caught) {
          this.purse.caught = true;
          sfx.coin(8);
          for (let i = 0; i < 18; i++) this.spark(w.x, w.y - 18, '#ffd04d');
          this.popups.push({ x: w.x, y: w.y - 40, text: `+${formatMoney(this.mercy.bribe)}`, col: '#ffd04d', size: 6, age: 0, life: 2.2, vy: -8, font: 'pixel' });
          this.addBanner(UI.spared, l.name, '#ffd77a', 0.3, 2.2, 22);
          sfx.crowd(0.9, 1.8);
        }
      }
      w.anim = this.purse?.caught ? 'cheer' : 'idle';
      w.animT = t;
      if (t >= 3.6) this.setPhase('done');
    } else {
      // ehrenvoll: Hand reichen, aufhelfen, Arm hochreißen
      const helpT = F.walk + 0.1;
      const riseT = F.walk + 0.55;
      const upT = riseT + 0.6;
      if (t >= F.walk && t < upT) {
        w.anim = 'help';
        w.animT = t - helpT;
      } else if (t >= upT) {
        w.anim = 'cheer';
        w.animT = t - upT;
      }
      if (t < riseT) {
        l.anim = 'death';
        l.frameOverride = kf;
      } else if (t < upT) {
        l.anim = 'death';
        l.frameOverride = Math.max(0, kf - Math.floor(((t - riseT) / 0.6) * (kf + 1)));
      } else {
        l.anim = t > upT + 0.25 ? 'cheer' : 'idle';
        l.animT = t - upT;
      }
      if (t >= upT && !this.fired('honor')) {
        this.addBanner(UI.honor, `${w.name} spares ${l.name}`, '#ffd77a', 0.3, 2.6, 24);
        sfx.fanfare();
        sfx.crowd(1.3, 2.4);
        this.excite = 1;
        for (let i = 0; i < 60; i++) this.confetti();
      }
      this.dark = Math.max(0, this.dark - dt);
      if (t >= upT + 2.8) this.setPhase('done');
    }
  }

  private impact(style: Style) {
    const l = this.f[this.loser];
    const w = this.f[this.winner];
    this.hitstop = 0.22;
    this.shake = 7;
    this.flashA = this.opts.blood ? 0.35 : 0.7;
    this.slowmo = 0.3;
    this.slowmoT = 1.1;
    sfx.execute();
    const neckY = l.y - 21;
    const chestY = l.y - 15;
    if (style === 'heavy') {
      if (this.opts.blood && l.def.head) {
        this.head = { x: l.x, y: neckY - 3, vx: w.face * 55, vy: -95, rot: 0, vr: w.face * 9, rest: false };
        this.fountain = 1.3;
      }
      this.burst(l.x, neckY, w.face, 30, l.y);
    } else if (style === 'swift') {
      this.burst(l.x - w.face * 2, chestY, w.face, 34, l.y);
    } else {
      this.burst(l.x, chestY, w.face, 22, l.y);
    }
  }

  private stepAfter() {
    const w = this.f[this.winner];
    w.anim = 'cheer';
    w.animT = this.phaseT;
    this.dark = Math.max(this.choice === 'kill' ? 0.3 : 0, this.dark - 0.01);
  }

  // ---------- Partikel ----------

  private burst(x: number, y: number, dir: number, n: number, groundY: number) {
    for (let i = 0; i < n; i++) {
      if (this.opts.blood) {
        const cols = ['#a01818', '#c22a2a', '#6d0d0d', '#d83a2a'];
        this.particles.push({
          x,
          y,
          vx: dir * (10 + this.fx() * 40) + (this.fx() - 0.5) * 20,
          vy: -30 - this.fx() * 60,
          life: 0,
          max: 2.5,
          col: cols[Math.floor(this.fx() * cols.length)],
          size: this.fx() < 0.25 ? 2 : 1,
          ground: groundY - 2 + this.fx() * 8,
          blood: true,
        });
      } else {
        this.spark(x, y, this.fx() < 0.5 ? '#fff3b0' : '#ffffff', dir);
      }
    }
  }

  private spark(x: number, y: number, col: string, dir = 0) {
    const a = this.fx() * Math.PI * 2;
    const s = 30 + this.fx() * 60;
    this.particles.push({ x, y, vx: Math.cos(a) * s + dir * 20, vy: Math.sin(a) * s - 20, life: 0, max: 0.45 + this.fx() * 0.3, col, size: 1, ground: 999, blood: false });
  }

  private confetti() {
    const cols = ['#5fdc5f', '#ffd04d', '#ffffff', '#e2b44d'];
    this.particles.push({
      x: this.fx() * W,
      y: 10 + this.fx() * 30,
      vx: (this.fx() - 0.5) * 40,
      vy: -20 - this.fx() * 30,
      life: 0,
      max: 2.2,
      col: cols[Math.floor(this.fx() * cols.length)],
      size: 1,
      ground: FLOOR_Y + 10 + this.fx() * 80,
      blood: false,
    });
  }

  private stepParticles(dt: number) {
    if (this.fountain > 0 && this.opts.blood) {
      this.fountain -= dt;
      const l = this.f[this.loser];
      // Hals zeigt nach dem Umkippen grob nach hinten oben
      for (let i = 0; i < 3; i++) {
        this.particles.push({
          x: l.x - l.face * 6,
          y: l.y - 12,
          vx: -l.face * (10 + this.fx() * 30),
          vy: -50 - this.fx() * 50,
          life: 0,
          max: 2,
          col: this.fx() < 0.5 ? '#a01818' : '#c22a2a',
          size: 1,
          ground: l.y - 2 + this.fx() * 6,
          blood: true,
        });
      }
    }
    const g = 240;
    for (const p of this.particles) {
      p.life += dt;
      p.vy += g * dt * (p.blood ? 1 : 0.4);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.y >= p.ground) {
        if (p.blood) {
          this.dc.fillStyle = p.col;
          this.dc.globalAlpha = 0.85;
          this.dc.fillRect(Math.round(p.x), Math.round(p.ground), p.size + (this.fx() < 0.3 ? 1 : 0), 1);
          this.dc.globalAlpha = 1;
        }
        p.life = p.max;
      }
    }
    this.particles = this.particles.filter((p) => p.life < p.max);
    for (const p of this.popups) {
      p.age += dt;
      p.y += p.vy * dt;
      p.vy *= 0.96;
    }
    this.popups = this.popups.filter((p) => p.age < p.life);
    for (const s of this.slashes) s.age += dt;
    this.slashes = this.slashes.filter((s) => s.age < s.life);
    for (const b of this.banners) b.age += dt;
    this.banners = this.banners.filter((b) => b.age < b.life);
    if (this.head && !this.head.rest) {
      const hd = this.head;
      hd.vy += g * dt;
      hd.x += hd.vx * dt;
      hd.y += hd.vy * dt;
      hd.rot += hd.vr * dt;
      const ground = FIGHT_Y - 3;
      if (hd.y >= ground) {
        hd.y = ground;
        if (Math.abs(hd.vy) > 50) {
          hd.vy *= -0.35;
          hd.vx *= 0.5;
          hd.vr *= 0.5;
          if (this.opts.blood) for (let i = 0; i < 4; i++) this.dc.fillRect(Math.round(hd.x + i - 2), ground + 2, 1, 1);
        } else {
          hd.rest = true;
          hd.rot = Math.round(hd.rot / (Math.PI / 2)) * (Math.PI / 2);
        }
      }
    }
  }

  private addBanner(text: string, sub: string | undefined, col: string, y: number, life: number, size: number) {
    this.banners.push({ text, sub, col, age: 0, life, y, size });
  }

  // ---------- Zeichnen ----------

  private draw() {
    if (!this.f) return;
    const c = this.lc;
    c.clearRect(0, 0, W, H);
    c.drawImage(this.backdrop, 0, 0);
    drawTorches(c, this.time);
    this.drawCrowd(c);
    c.drawImage(this.decals, 0, 0);

    const order = [...this.f].sort((p, q) => p.y - q.y);
    for (const x of order) this.drawShadow(c, x);
    if (this.dark > 0) this.drawDark(c);
    for (const x of order) this.drawFighter(c, x);
    if (this.spearThrough) this.drawSpearThrough(c);
    this.drawHead(c);
    this.drawPurse(c);
    for (const s of this.slashes) this.drawSlash(c, s);
    for (const p of this.particles) {
      const a = p.blood ? 1 : Math.max(0, 1 - p.life / p.max);
      c.globalAlpha = a;
      c.fillStyle = p.col;
      c.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    c.globalAlpha = 1;

    // hochskalieren
    const d = this.ctx;
    const u = this.scale * this.dpr;
    d.setTransform(1, 0, 0, 1, 0, 0);
    d.imageSmoothingEnabled = false;
    d.fillStyle = '#000';
    d.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const sx = this.shake ? Math.round((this.fx() - 0.5) * this.shake) * u : 0;
    const sy = this.shake ? Math.round((this.fx() - 0.5) * this.shake) * u : 0;
    const v = this.view();
    d.drawImage(this.low, v.x0, v.y0, v.vw, v.vh, sx, sy, W * u, H * u);
    if (this.flashA > 0) {
      d.fillStyle = `rgba(255,255,255,${this.flashA})`;
      d.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    if (this.danger > 0) this.drawDanger(d);
    d.setTransform(u * v.z, 0, 0, u * v.z, sx - v.x0 * u * v.z, sy - v.y0 * u * v.z);
    this.drawPlates(d);
    for (const p of this.popups) this.drawPopup(d, p);
    d.setTransform(u, 0, 0, u, 0, 0);
    this.drawHud(d);
    this.drawVote(d);
    this.drawBribe(d);
    for (const b of this.banners) this.drawBanner(d, b);
  }

  /** Roter Rand im Herzschlag, solange einer unter der Last-Stand-Grenze ist. */
  private drawDanger(d: CanvasRenderingContext2D) {
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const beat = Math.max(0, 1 - (0.75 - this.beatT) / 0.25);
    const a = this.danger * (0.22 + 0.25 * beat);
    const g = d.createRadialGradient(cw / 2, ch / 2, ch * 0.35, cw / 2, ch / 2, cw * 0.62);
    g.addColorStop(0, 'rgba(120,0,0,0)');
    g.addColorStop(1, `rgba(150,0,0,${a})`);
    d.fillStyle = g;
    d.fillRect(0, 0, cw, ch);
  }

  private drawCrowd(c: CanvasRenderingContext2D) {
    const n = this.mercy.spectators;
    const taken = new Set(this.seatOf.slice(0, n));
    const t = this.time;
    for (let i = 0; i < this.seats.length; i++) {
      if (!taken.has(i)) continue;
      const s = this.seats[i];
      const jump = Math.max(0, Math.sin(t * 9 + s.phase)) * this.excite * 2.2;
      const y = Math.round(s.y - jump);
      const vote = this.voted.get(i);
      c.fillStyle = s.cloth;
      c.fillRect(s.x, y + 3, 4, 3);
      c.fillStyle = vote === undefined ? s.skin : vote ? '#5fdc5f' : '#e04a3a';
      c.fillRect(s.x + 1, y, 3, 3);
      if (vote !== undefined) {
        // erhobener Arm mit Daumen
        c.fillStyle = s.skin;
        c.fillRect(s.x + 4, y - 1, 1, 3);
        c.fillStyle = vote ? '#5fdc5f' : '#e04a3a';
        c.fillRect(s.x + 4, vote ? y - 3 : y + 2, 1, 2);
      }
    }
  }

  private drawShadow(c: CanvasRenderingContext2D, x: Fighter) {
    if (x.hidden) return;
    const cx = Math.round(x.x + x.ox);
    c.fillStyle = 'rgba(40,20,5,0.35)';
    c.beginPath();
    c.ellipse(cx, x.y, 9, 3, 0, 0, Math.PI * 2);
    c.fill();
    // Teamring wie in Arena-Autokämpfern
    c.strokeStyle = TEAMS[x.side].main;
    c.globalAlpha = 0.75;
    c.beginPath();
    c.ellipse(cx, x.y, 11, 4, 0, 0, Math.PI * 2);
    c.stroke();
    c.globalAlpha = 1;
    if (x.lastStand && this.phase === 'fight') {
      c.strokeStyle = `rgba(255,120,40,${0.5 + 0.4 * Math.sin(this.time * 12)})`;
      c.beginPath();
      c.ellipse(cx, x.y, 13, 5, 0, 0, Math.PI * 2);
      c.stroke();
    }
  }

  private frameOf(x: Fighter): { a: AnimDef; frame: number } {
    const a = anim(x.def, x.anim);
    const frame = x.frameOverride !== null ? Math.min(a.frames - 1, Math.max(0, x.frameOverride)) : frameAt(a, x.animT);
    return { a, frame };
  }

  private drawFighter(c: CanvasRenderingContext2D, x: Fighter) {
    if (x.hidden) return;
    const { a, frame } = this.frameOf(x);
    const def = x.def;
    const fw = def.frameW;
    const fh = def.frameH;
    const flip = (def.facing === 'right' ? 1 : -1) !== x.face;
    const dx = Math.round(x.x + x.ox);
    const dy = Math.round(x.y + x.oy);
    const t = this.sprTmp.getContext('2d')!;
    t.imageSmoothingEnabled = false;
    t.clearRect(0, 0, this.sprTmp.width, this.sprTmp.height);
    t.drawImage(x.sheet, frame * fw, a.row * fh, fw, fh, 0, 0, fw, fh);
    if (x.flash > 0) {
      t.globalCompositeOperation = 'source-atop';
      t.fillStyle = 'rgba(255,255,255,0.85)';
      t.fillRect(0, 0, fw, fh);
      t.globalCompositeOperation = 'source-over';
    }
    c.save();
    c.translate(dx, dy);
    if (x.rot) {
      c.translate(0, -12);
      c.rotate(x.rot);
      c.translate(0, 12);
    }
    if (flip) c.scale(-1, 1);
    c.drawImage(this.sprTmp, 0, 0, fw, fh, -def.anchorX, -def.anchorY, fw, fh);
    c.restore();
  }

  private drawDark(c: CanvasRenderingContext2D) {
    const w = this.f[this.winner];
    const l = this.f[this.loser];
    const cx = (w.x + l.x) / 2;
    const g = c.createRadialGradient(cx, FIGHT_Y - 14, 14, cx, FIGHT_Y - 14, 70);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(5,0,0,${this.dark})`);
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
  }

  private drawSpearThrough(c: CanvasRenderingContext2D) {
    const w = this.f[this.winner];
    const l = this.f[this.loser];
    const y = l.y - 16 + l.oy;
    const x0 = w.x + w.face * 8;
    const x1 = l.x + w.face * 12;
    c.fillStyle = '#8a5a32';
    c.fillRect(Math.min(x0, x1), y, Math.abs(x1 - x0), 1);
    c.fillStyle = '#eef3f6';
    c.fillRect(x1 - (w.face > 0 ? 0 : 3), y - 1, 3, 3);
    if (this.opts.blood) {
      c.fillStyle = '#a01818';
      c.fillRect(x1 - w.face * 2, y + 1, 2, 1);
      if (this.fx() < 0.3) this.particles.push({ x: x1, y: y + 1, vx: 0, vy: 10, life: 0, max: 2, col: '#a01818', size: 1, ground: l.y + 2, blood: true });
    }
  }

  private drawHead(c: CanvasRenderingContext2D) {
    const hd = this.head;
    if (!hd) return;
    const l = this.f[this.loser];
    const h = l.def.head!;
    const fw = l.def.frameW;
    const fh = l.def.frameH;
    c.save();
    c.translate(Math.round(hd.x), Math.round(hd.y));
    c.rotate(hd.rot);
    if (l.face < 0 === (l.def.facing === 'right')) c.scale(-1, 1);
    c.drawImage(l.sheet, h.frame * fw, h.row * fh, fw, fh, -fw / 2, -fh / 2, fw, fh);
    c.restore();
  }

  private drawPurse(c: CanvasRenderingContext2D) {
    const p = this.purse;
    if (!p || p.caught) return;
    const k = Math.min(1, p.t / p.dur);
    const x = p.x0 + (p.x1 - p.x0) * k;
    const y = p.y0 + (p.y1 - p.y0) * k - Math.sin(Math.PI * k) * 26;
    const px = Math.round(x);
    const py = Math.round(y);
    c.fillStyle = '#1a1210';
    c.fillRect(px - 3, py - 3, 7, 7);
    c.fillStyle = '#7a4a2a';
    c.fillRect(px - 2, py - 1, 5, 4);
    c.fillStyle = '#ffd04d';
    c.fillRect(px - 1, py - 2, 3, 1);
    c.fillRect(px, py, 1, 1);
    if (this.fx() < 0.5) this.spark(x, y, '#ffd04d');
  }

  private drawSlash(c: CanvasRenderingContext2D, s: Slash) {
    const k = s.age / s.life;
    const r = (s.big ? 11 : 8) + k * 4;
    c.fillStyle = s.col;
    c.globalAlpha = 1 - k;
    for (let a = -1.1; a <= 1.1; a += 0.12) {
      const x = s.x + Math.cos(a) * r * s.dir * 0.6;
      const y = s.y + Math.sin(a) * r;
      c.fillRect(Math.round(x), Math.round(y), 1, s.big ? 2 : 1);
    }
    if (s.big) {
      c.strokeStyle = s.col;
      c.beginPath();
      c.ellipse(s.x, s.y + 6, 4 + k * 18, 2 + k * 6, 0, 0, Math.PI * 2);
      c.stroke();
    }
    c.globalAlpha = 1;
  }

  // ---------- Schrift und HUD (Welt-Einheiten, scharf gezeichnet) ----------

  private text(d: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, col: string, font: 'pixel' | 'serif' | 'sans', align: CanvasTextAlign = 'center', outline = 1.6) {
    d.font = font === 'pixel' ? `${size}px "Press Start 2P", monospace` : font === 'serif' ? `800 ${size}px Cinzel, Georgia, serif` : `700 ${size}px Inter, system-ui, sans-serif`;
    d.textAlign = align;
    d.textBaseline = 'middle';
    d.lineJoin = 'round';
    if (outline) {
      d.strokeStyle = '#140c06';
      d.lineWidth = outline;
      d.strokeText(s, x, y);
    }
    d.fillStyle = col;
    d.fillText(s, x, y);
  }

  private drawPlates(d: CanvasRenderingContext2D) {
    if (this.phase !== 'fight') return;
    const gap = Math.abs(this.f[1].x - this.f[0].x);
    for (const x of this.f) {
      if (x.hidden) continue;
      // Namen nicht übereinander: bei engem Abstand nach außen schieben
      const cx = x.x + x.ox - x.face * Math.max(0, 30 - gap) * 0.6;
      const top = x.y - 46;
      this.text(d, '♛', cx, top - 7, 6, '#e2b44d', 'sans', 'center', 1.2);
      this.text(d, x.name, cx, top, 5, '#f3e6cc', 'serif', 'center', 1.4);
      // kleiner HP-Balken
      const bw = 22;
      const bx = cx - bw / 2;
      const by = top + 3.5;
      d.fillStyle = '#140c06';
      d.fillRect(bx - 0.5, by - 0.5, bw + 1, 3);
      d.fillStyle = '#5a4630';
      d.fillRect(bx, by, bw, 2);
      d.fillStyle = '#fff2c0';
      d.fillRect(bx, by, (bw * x.hpGhost) / x.maxHp, 2);
      d.fillStyle = TEAM_UI[x.side];
      d.fillRect(bx, by, (bw * x.hp) / x.maxHp, 2);
    }
  }

  private drawPopup(d: CanvasRenderingContext2D, p: Popup) {
    const k = p.age / p.life;
    const pop = p.age < 0.08 ? 1 + (0.08 - p.age) * 8 : 1;
    d.globalAlpha = k > 0.7 ? Math.max(0, 1 - (k - 0.7) / 0.3) : 1;
    this.text(d, p.text, p.x, p.y, p.size * 0.6 * pop, p.col, p.font, 'center', 1.4);
    d.globalAlpha = 1;
  }

  private drawHud(d: CanvasRenderingContext2D) {
    // große Lebensbalken unten
    const y = H - 10;
    const bw = 96;
    for (const x of this.f) {
      const left = x.side === 0;
      const bx = left ? 6 : W - 6 - bw;
      d.fillStyle = 'rgba(15,9,4,0.8)';
      d.fillRect(bx - 1.5, y - 7.5, bw + 3, 15);
      d.fillStyle = '#3a2c1e';
      d.fillRect(bx, y, bw, 5);
      const ghost = (bw * x.hpGhost) / x.maxHp;
      const hp = (bw * x.hp) / x.maxHp;
      d.fillStyle = '#fff2c0';
      d.fillRect(left ? bx : bx + bw - ghost, y, ghost, 5);
      d.fillStyle = TEAM_UI[x.side];
      d.fillRect(left ? bx : bx + bw - hp, y, hp, 5);
      d.fillStyle = 'rgba(255,255,255,0.25)';
      d.fillRect(bx, y, bw, 1);
      this.text(d, x.name, left ? bx : bx + bw, y - 3.5, 5, '#f3e6cc', 'serif', left ? 'left' : 'right', 0);
      this.text(d, `${Math.max(0, Math.round(x.hp))}`, left ? bx + bw : bx, y - 3.5, 3.2, '#cdbd9f', 'pixel', left ? 'right' : 'left', 0);
    }
    if (this.phase === 'fight' || this.phase === 'intro') {
      const t = Math.max(0, this.simT);
      this.text(d, t.toFixed(1), W / 2, H - 8, 4, '#e2b44d', 'pixel', 'center', 1);
    }
  }

  private drawVote(d: CanvasRenderingContext2D) {
    if (!['vote', 'choose'].includes(this.phase)) return;
    const vs = this.mercy.voteSeconds;
    const t = this.phase === 'vote' ? this.phaseT : vs;
    const { spare, kill } = tally(this.mercy.votes, t);
    const cy = 54;
    this.text(d, UI.mercy, W / 2, cy, 12, '#ffd77a', 'serif', 'center', 2.2);
    const left = Math.max(0, Math.ceil(vs - t));
    const who = this.mercy.npc ? UI.rabbleDecides : UI.crowdDecides;
    this.text(d, this.phase === 'vote' ? `${who} · ${left}` : UI.yourCall, W / 2, cy + 10, 5, '#efe4d2', 'sans', 'center', 1.2);
    if (this.phase === 'vote' && !this.opts.choice) this.text(d, UI.decideEarly, W / 2, cy + 27, 3.8, '#cdbd9f', 'sans', 'center', 1);
    const bw = 90;
    const bx = W / 2 - bw / 2;
    const by = cy + 15;
    const tot = Math.max(1, spare + kill);
    d.fillStyle = '#140c06';
    d.fillRect(bx - 1, by - 1, bw + 2, 7);
    d.fillStyle = '#3a2c1e';
    d.fillRect(bx, by, bw, 5);
    d.fillStyle = '#5fdc5f';
    d.fillRect(bx, by, (bw * spare) / tot, 5);
    d.fillStyle = '#e04a3a';
    d.fillRect(bx + bw - (bw * kill) / tot, by, (bw * kill) / tot, 5);
    this.text(d, `👍 ${UI.spare} ${spare}`, bx - 3, by + 2.5, 4.4, '#7dff8a', 'sans', 'right', 1.2);
    this.text(d, `${kill} ${UI.killVote} 👎`, bx + bw + 3, by + 2.5, 4.4, '#ff6b5a', 'sans', 'left', 1.2);
    // Zeitring
    if (this.phase === 'vote') {
      d.strokeStyle = '#e2b44d';
      d.lineWidth = 1.2;
      d.beginPath();
      d.arc(W / 2 + 34, cy, 4.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - t / vs));
      d.stroke();
    }
  }

  private drawBribe(d: CanvasRenderingContext2D) {
    if (!['vote', 'choose'].includes(this.phase)) return;
    const l = this.f[this.loser];
    const txt = `${l.name} ${UI.offers} ${formatMoney(this.mercy.bribe)}`;
    const x = Math.max(40, Math.min(W - 40, l.x));
    const y = l.y + 13;
    d.font = '700 5px Inter, system-ui, sans-serif';
    const w = d.measureText(txt).width + 14;
    d.fillStyle = 'rgba(20,12,6,0.88)';
    d.strokeStyle = '#e2b44d';
    d.lineWidth = 0.6;
    d.beginPath();
    d.roundRect(x - w / 2, y - 6, w, 12, 3);
    d.fill();
    d.stroke();
    d.beginPath();
    d.moveTo(l.x - 2, y - 6);
    d.lineTo(l.x, y - 9);
    d.lineTo(l.x + 2, y - 6);
    d.fill();
    d.fillStyle = '#ffd04d';
    d.beginPath();
    d.arc(x - w / 2 + 5, y, 2.4, 0, Math.PI * 2);
    d.fill();
    this.text(d, txt, x + 3, y + 0.3, 5, '#ffe7a3', 'sans', 'center', 0);
  }

  private drawBanner(d: CanvasRenderingContext2D, b: Banner) {
    const k = b.age / b.life;
    const pop = b.age < 0.15 ? 0.6 + (b.age / 0.15) * 0.4 + Math.sin((b.age / 0.15) * Math.PI) * 0.25 : 1;
    d.globalAlpha = k > 0.8 ? Math.max(0, 1 - (k - 0.8) / 0.2) : 1;
    if (b.size < 0) {
      // Form-Einblendung über einem Kämpfer
      const x = this.f[b.size === -1 ? 0 : 1];
      const cx = x.side === 0 ? W * 0.27 : W * 0.73;
      this.text(d, b.sub ?? '', cx, H * b.y - 9, 6 * pop, '#efe4d2', 'serif', 'center', 1.6);
      this.text(d, b.text, cx, H * b.y + 3, 11 * pop, b.col, 'pixel', 'center', 2.4);
      this.text(d, 'Form', cx, H * b.y + 13, 4, '#a8977f', 'sans', 'center', 1);
    } else {
      this.text(d, b.text, W / 2, H * b.y, b.size * 0.6 * pop, b.col, 'serif', 'center', 2.4);
      if (b.sub) this.text(d, b.sub, W / 2, H * b.y + b.size * 0.45, 6, '#efe4d2', 'serif', 'center', 1.4);
    }
    d.globalAlpha = 1;
  }

  // ---------- Knöpfe (DOM über dem Canvas) ----------

  private mercyBtns: HTMLButtonElement[] = [];

  private renderMercyButtons() {
    const choices: MercyChoice[] = ['gold', 'honor', 'kill'];
    const wrap = document.createElement('div');
    wrap.className = 'mercy-bar';
    this.mercyBtns = choices.map((c) => {
      const b = document.createElement('button');
      b.className = `mercy-btn ${c}`;
      const title = document.createElement('b');
      title.textContent = c === 'gold' ? `${MERCY_NAMES.gold} · ${formatMoney(this.mercy.bribe)}` : MERCY_NAMES[c];
      const hint = document.createElement('small');
      hint.textContent = MERCY_HINTS[c];
      b.append(title, hint);
      b.onpointerdown = () => unlockAudio();
      b.onclick = () => {
        b.classList.add('chosen');
        this.decide(c);
      };
      return b;
    });
    wrap.append(...this.mercyBtns);
    this.ui.replaceChildren(wrap);
    this.updateVoteButtons();
  }

  private updateVoteButtons() {
    const locked = !!this.opts.choice;
    for (const b of this.mercyBtns) {
      b.disabled = locked;
      b.classList.toggle('ready', !locked);
    }
  }

  private renderSummary() {
    const o = this.outcome!;
    const w = this.f[this.winner];
    const l = this.f[this.loser];
    const box = document.createElement('div');
    box.className = 'arena-summary';
    const line = (label: string, value: string, cls = '') => {
      const r = document.createElement('div');
      r.className = `sum-line ${cls}`;
      const a = document.createElement('span');
      a.textContent = label;
      const b = document.createElement('b');
      b.textContent = value;
      r.append(a, b);
      return r;
    };
    const h = document.createElement('h3');
    h.textContent = `${w.name} · ${MERCY_NAMES[o.choice]}`;
    box.append(h);
    const crowd = o.majority === 'tie' ? 'Crowd split' : `Crowd wanted ${o.majority === 'spare' ? 'mercy' : 'blood'} (${o.spareVotes} : ${o.killVotes})`;
    box.append(line(crowd, o.followed === null ? '' : o.followed ? 'followed' : 'defied', o.followed ? 'good' : o.followed === false ? 'bad' : ''));
    box.append(line(UI.fame, `${o.fame >= 0 ? '+' : '−'}${Math.abs(o.fame)}`, o.fame > 0 ? 'good' : o.fame < 0 ? 'bad' : ''));
    if (o.gold) box.append(line('Gold', `+${formatMoney(o.gold)}`, 'gold'));
    if (o.honor) box.append(line(UI.honorPts, `+${o.honor}`, 'good'));
    if (o.butcher) box.append(line(UI.butcherPts, `+${o.butcher}`, 'bad'));
    if (o.loserDies) box.append(line(l.name, `dies · ${UI.fullLoot}`, 'bad'));
    else box.append(line(l.name, `lives · ${UI.scar} −${o.scar}`, ''));
    const row = document.createElement('div');
    row.className = 'sum-actions';
    const replay = document.createElement('button');
    replay.className = 'btn';
    replay.textContent = `↺ ${UI.replay}`;
    replay.onclick = () => {
      sfx.click();
      this.opts.onReplay?.();
    };
    const next = document.createElement('button');
    next.className = 'btn gold';
    next.textContent = 'Next fight ▸';
    next.onclick = () => {
      sfx.click();
      this.opts.onNewFight?.();
    };
    row.append(replay, next);
    box.append(row);
    this.ui.replaceChildren(box);
  }
}
