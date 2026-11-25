// Choreografie: legt aus den Ereignissen der Simulation fest, wann welcher Gladiator ausholt,
// damit das Trefferbild der Angriffs-Animation genau auf den Zeitpunkt des Treffers fällt.
// Ohne DOM, darum testbar.

import type { FightEvent } from '../sim/types';
import type { AnimDef } from './sprites';

export interface Swing {
  start: number; // Beginn der Animation (Sekunden Kampfzeit)
  hitT: number; // Zeitpunkt des Treffers laut Simulation
  end: number;
  rate: number; // Abspieltempo der Animation, 1 = wie im Sheet
  dodged: boolean;
}

export interface Reaction {
  t: number;
  kind: 'hit' | 'dodge';
  crit: boolean;
  lucky: boolean;
}

export interface Choreo {
  swings: [Swing[], Swing[]];
  reactions: [Reaction[], Reaction[]];
}

/** Zeit vom Animationsbeginn bis zum Trefferbild. */
export function windup(a: AnimDef): number {
  return (a.hitFrame ?? Math.floor(a.frames / 2)) / a.fps;
}

export function buildChoreo(events: FightEvent[], attack: [AnimDef, AnimDef]): Choreo {
  const swings: [Swing[], Swing[]] = [[], []];
  const reactions: [Reaction[], Reaction[]] = [[], []];
  for (const e of events) {
    if (e.type === 'hit' || e.type === 'dodge') {
      const i = e.from;
      const a = attack[i];
      const dur = a.frames / a.fps;
      const list = swings[i];
      const prev = list[list.length - 1];
      // Schnelle Kämpfer schlagen öfter zu, als die Animation lang ist: dann wird sie schneller abgespielt.
      let rate = 1;
      if (prev) {
        const gap = e.t - prev.hitT;
        if (gap < dur) rate = Math.max(1, dur / Math.max(0.05, gap * 0.95));
      }
      const w = windup(a) / rate;
      const sw: Swing = { start: e.t - w, hitT: e.t, end: e.t - w + dur / rate, rate, dodged: e.type === 'dodge' };
      // Die vorige Animation endet spätestens, wenn die neue beginnt.
      if (prev && prev.end > sw.start) prev.end = sw.start;
      list.push(sw);
      const j = (1 - i) as 0 | 1;
      reactions[j].push(
        e.type === 'hit'
          ? { t: e.t, kind: 'hit', crit: e.crit, lucky: e.lucky }
          : { t: e.t, kind: 'dodge', crit: false, lucky: false },
      );
    }
  }
  return { swings, reactions };
}

/** Welche Animation läuft bei Kampfzeit t gerade, und welches Bild? */
export function swingAt(list: Swing[], t: number): { swing: Swing; frameTime: number } | null {
  for (const s of list) {
    if (s.start > t) break;
    if (t < s.end) return { swing: s, frameTime: (t - s.start) * s.rate };
  }
  return null;
}

export function lastReaction(list: Reaction[], t: number, within: number): Reaction | null {
  let r: Reaction | null = null;
  for (const x of list) {
    if (x.t > t) break;
    if (t - x.t <= within) r = x;
  }
  return r;
}

/** Bild einer Animation zur Zeit t (Sekunden seit Beginn). */
export function frameAt(a: AnimDef, t: number): number {
  const f = Math.floor(Math.max(0, t) * a.fps);
  return a.loop ? f % a.frames : Math.min(a.frames - 1, f);
}
