// Klänge ohne Dateien, mit Web Audio erzeugt. Platzhalter wie die Grafik.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let muted = false;

export function setMuted(m: boolean) {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.5;
}
export function isMuted() {
  return muted;
}

/** Muss nach einem Klick laufen, sonst blockiert der Browser den Ton. */
export function unlockAudio() {
  if (!ctx) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      ctx = null;
    }
  }
  if (ctx?.state === 'suspended') void ctx.resume();
}

function ok(): boolean {
  return !!ctx && !!master && !muted;
}

function env(g: GainNode, t: number, peak: number, attack: number, decay: number) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function noiseHit(freq: number, q: number, peak: number, decay: number, delay = 0) {
  if (!ok() || !noise) return;
  const t = ctx!.currentTime + delay;
  const src = ctx!.createBufferSource();
  src.buffer = noise;
  const f = ctx!.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx!.createGain();
  env(g, t, peak, 0.004, decay);
  src.connect(f).connect(g).connect(master!);
  src.start(t, Math.random() * 0.5, decay + 0.05);
}

function tone(type: OscillatorType, f0: number, f1: number, peak: number, decay: number, delay = 0) {
  if (!ok()) return;
  const t = ctx!.currentTime + delay;
  const o = ctx!.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + decay);
  const g = ctx!.createGain();
  env(g, t, peak, 0.005, decay);
  o.connect(g).connect(master!);
  o.start(t);
  o.stop(t + decay + 0.05);
}

export const sfx = {
  hit(strength = 1) {
    noiseHit(900, 1.2, 0.35 * strength, 0.09);
    tone('sine', 140, 60, 0.4 * strength, 0.12);
  },
  crit() {
    noiseHit(2400, 2, 0.35, 0.08);
    tone('square', 880, 440, 0.08, 0.1);
    tone('sine', 160, 50, 0.5, 0.18);
  },
  crushing() {
    tone('sine', 90, 30, 0.9, 0.45);
    noiseHit(300, 0.8, 0.7, 0.35);
    noiseHit(3000, 1, 0.25, 0.12);
  },
  dodge() {
    noiseHit(4000, 3, 0.12, 0.12);
  },
  heal() {
    tone('triangle', 520, 780, 0.08, 0.15);
  },
  horn() {
    tone('sawtooth', 220, 230, 0.12, 0.6);
    tone('sawtooth', 330, 335, 0.08, 0.6, 0.05);
  },
  step() {
    noiseHit(500, 2, 0.05, 0.04);
  },
  crowd(intensity = 1, dur = 1.6) {
    if (!ok() || !noise) return;
    const t = ctx!.currentTime;
    const src = ctx!.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const f = ctx!.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 700;
    f.Q.value = 0.6;
    const g = ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22 * intensity, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master!);
    src.start(t);
    src.stop(t + dur + 0.1);
  },
  coin(n = 6) {
    for (let i = 0; i < n; i++) tone('triangle', 1800 + Math.random() * 900, 1500, 0.07, 0.12, i * 0.06);
  },
  click() {
    tone('square', 420, 200, 0.07, 0.05);
    noiseHit(2500, 3, 0.08, 0.03);
  },
  tick() {
    tone('square', 1200, 1100, 0.04, 0.03);
  },
  vote() {
    tone('triangle', 600 + Math.random() * 200, 500, 0.02, 0.04);
  },
  execute() {
    tone('sine', 70, 25, 1, 0.7);
    noiseHit(200, 0.7, 0.8, 0.5);
  },
  heartbeat() {
    tone('sine', 70, 45, 0.5, 0.12);
    tone('sine', 65, 40, 0.35, 0.12, 0.17);
  },
  fanfare() {
    [523, 659, 784, 1046].forEach((f, i) => tone('sawtooth', f, f, 0.07, 0.25, i * 0.11));
  },
  /** Spitzhacke trifft Stein: leise, damit zwei Minen nicht nerven. */
  pick() {
    noiseHit(3200, 4, 0.05, 0.05);
    tone('square', 900 + Math.random() * 200, 700, 0.015, 0.04);
  },
  /** Brocken landet in der Lore. */
  clunk() {
    noiseHit(400, 1.5, 0.08, 0.08);
  },
  /** Neuer Brief im Postfach. */
  mail() {
    tone('triangle', 880, 880, 0.06, 0.12);
    tone('triangle', 1320, 1320, 0.06, 0.18, 0.1);
  },
  /** Aufdecken einer verdeckten Karte, je seltener desto größer. */
  reveal(rank: number) {
    noiseHit(1800, 2, 0.12, 0.08);
    if (rank >= 1) tone('triangle', 660 + rank * 110, 660 + rank * 110, 0.07, 0.2);
    if (rank >= 2) tone('sine', 220, 440, 0.12, 0.35, 0.05);
    if (rank >= 3) [784, 988, 1175, 1568].forEach((f, i) => tone('triangle', f, f, 0.09, 0.4, 0.06 + i * 0.07));
    if (rank >= 4) {
      tone('sawtooth', 110, 55, 0.25, 1.2);
      [1046, 1318, 1568, 2093].forEach((f, i) => tone('sine', f, f, 0.1, 0.8, 0.15 + i * 0.09));
    }
  },
  /** Verdeckte Karte zittert vor dem Aufdecken. */
  suspense() {
    tone('sine', 180, 260, 0.06, 0.5);
  },
  claim() {
    for (let i = 0; i < 8; i++) tone('triangle', 1400 + i * 120, 1300 + i * 120, 0.06, 0.1, i * 0.04);
    tone('sine', 200, 120, 0.2, 0.2);
  },
};
