import { describe, expect, it } from 'vitest';
import { simulate } from '../src/sim/combat';
import { cloneConfig, DEFAULT_CONFIG } from '../src/sim/config';
import { makeGladiator } from '../src/sim/factory';
import { closeness, resolveMercy, setupMercy, tally } from '../src/sim/mercy';
import { formLabel } from '../src/sim/names';
import { SPRITES } from '../src/render/sprites';
import { buildChoreo, frameAt, swingAt, windup } from '../src/render/timeline';

const cfg = DEFAULT_CONFIG;
const a = makeGladiator({ name: 'A', style: 'heavy', base: { atk: 7, def: 6, hp: 7, spd: 4 } });
const b = makeGladiator({ name: 'B', style: 'swift', base: { atk: 5, def: 5, hp: 6, spd: 9 } });

describe('Choreografie', () => {
  it('jeder Treffer und jedes Ausweichen hat eine Angriffs-Animation, deren Trefferbild genau auf dem Ereignis liegt', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const r = simulate(a, b, seed, cfg, { events: true });
      const ch = buildChoreo(r.events!, [SPRITES.heavy.anims.attack, SPRITES.swift.anims.attack]);
      const attacks = r.events!.filter((e) => e.type === 'hit' || e.type === 'dodge');
      expect(ch.swings[0].length + ch.swings[1].length).toBe(attacks.length);
      for (const side of [0, 1] as const) {
        const list = ch.swings[side];
        for (let i = 0; i < list.length; i++) {
          const s = list[i];
          const def = side === 0 ? SPRITES.heavy.anims.attack : SPRITES.swift.anims.attack;
          // Trefferbild liegt auf hitT
          expect(s.start + windup(def) / s.rate).toBeCloseTo(s.hitT, 9);
          // Animationen eines Kämpfers überlappen nicht
          if (i > 0) expect(list[i - 1].end).toBeLessThanOrEqual(s.start + 1e-9);
          const at = swingAt(list, s.hitT);
          expect(at?.swing).toBe(s);
          expect(frameAt(def, at!.frameTime + 1e-9)).toBe(def.hitFrame);
        }
      }
    }
  });

  it('sehr schnelle Angreifer: Animation wird schneller abgespielt statt abgeschnitten', () => {
    const events = [0.1, 0.3, 0.5, 0.7].map((t) => ({ t, type: 'hit' as const, from: 0 as const, dmg: 10, crit: false, lucky: false, hpLeft: 100 }));
    const ch = buildChoreo(events, [SPRITES.swift.anims.attack, SPRITES.heavy.anims.attack]);
    expect(ch.swings[0].some((s) => s.rate > 1)).toBe(true);
  });
});

describe('Mercy', () => {
  it('ist deterministisch: gleicher Seed, gleiche Abstimmung und Bestechung', () => {
    const r = simulate(a, b, 9, cfg, { events: true });
    expect(setupMercy(a, b, r, 9, cfg)).toEqual(setupMercy(a, b, r, 9, cfg));
  });

  it('Zuschauerzahl kommt aus der Arena-Klasse, Bestechung liegt im eingestellten Rahmen', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const r = simulate(a, b, seed, cfg, { events: true });
      const m = setupMercy(a, b, r, seed, cfg);
      expect(m.spectators).toBe(cfg.mercy.spectators[m.classId]);
      expect(m.votes.length).toBeLessThanOrEqual(m.spectators);
      expect(m.bribe).toBeGreaterThanOrEqual(Math.floor(m.stake * cfg.mercy.bribeMin));
      expect(m.bribe).toBeLessThanOrEqual(Math.ceil(m.stake * cfg.mercy.bribeMax));
      for (const v of m.votes) expect(v.t).toBeLessThanOrEqual(cfg.mercy.voteSeconds);
    }
  });

  it('knappe Kämpfe bekommen mehr Daumen hoch als einseitige', () => {
    const c = cloneConfig(cfg);
    c.mercy.spectators = { bronze: 2000, silver: 2000, gold: 2000, champion: 2000 };
    const strong = makeGladiator({ style: 'heavy', base: { atk: 10, def: 10, hp: 10, spd: 10 } });
    const weak = makeGladiator({ style: 'heavy', base: { atk: 1, def: 1, hp: 1, spd: 1 } });
    const oneSided = simulate(strong, weak, 1, c, { events: true });
    let close = null;
    for (let s = 1; s < 200 && !close; s++) {
      const r = simulate(a, a, s, c, { events: true });
      if (closeness(r) > 0.8) close = { r, s };
    }
    expect(close).not.toBeNull();
    const t1 = tally(setupMercy(strong, weak, oneSided, 1, c).votes);
    const t2 = tally(setupMercy(a, a, close!.r, close!.s, c).votes);
    expect(t2.spare / (t2.spare + t2.kill)).toBeGreaterThan(t1.spare / (t1.spare + t1.kill));
  });

  it('Folgen der Entscheidung: Ruhm, Gold, Ehre, Schlächter, Narbe', () => {
    const r = simulate(a, b, 4, cfg, { events: true });
    const m = setupMercy(a, b, r, 4, cfg);
    const { spare, kill } = tally(m.votes);
    const voters = spare + kill;
    const gold = resolveMercy(m, 'gold', cfg);
    const honor = resolveMercy(m, 'honor', cfg);
    const k = resolveMercy(m, 'kill', cfg);
    expect(gold.gold).toBe(m.bribe);
    expect(honor.gold).toBe(0);
    expect(honor.honor).toBe(1);
    expect(k.butcher).toBe(1);
    expect(k.loserDies).toBe(true);
    expect(gold.scar).toBe(cfg.mercy.scar);
    expect(k.scar).toBe(0);
    if (spare !== kill) {
      // Wer der Mehrheit folgt, bekommt Ruhm pro Abstimmendem, sonst verliert er so viel
      expect(Math.abs(gold.fame)).toBe(voters * cfg.mercy.famePerVoter);
      expect(gold.fame).toBe(-k.fame);
      expect(gold.fame).toBe(honor.fame);
    }
  });
});

describe('Mercy früh entscheiden', () => {
  it('wer früh entscheidet, bekommt Ruhm nur für die Stimmen bis dahin', () => {
    const r = simulate(a, b, 4, cfg, { events: true });
    const m = setupMercy(a, b, r, 4, cfg);
    const early = resolveMercy(m, 'honor', cfg, 1);
    const late = resolveMercy(m, 'honor', cfg);
    expect(early.spareVotes + early.killVotes).toBeLessThan(late.spareVotes + late.killVotes);
    expect(Math.abs(early.fame)).toBeLessThanOrEqual(Math.abs(late.fame));
  });

  it('ohne Zuschauer stimmt ein kleines NPC-Publikum schnell ab', () => {
    const c = cloneConfig(cfg);
    c.mercy.spectators = { bronze: 0, silver: 0, gold: 0, champion: 0 };
    const r = simulate(a, b, 4, c, { events: true });
    const m = setupMercy(a, b, r, 4, c);
    expect(m.npc).toBe(true);
    expect(m.spectators).toBe(c.mercy.npcCrowd);
    for (const v of m.votes) expect(v.t).toBeLessThanOrEqual(c.mercy.npcVoteSeconds);
  });
});

describe('Form-Anzeige', () => {
  it('ordnet Tagesform den Stufen zu', () => {
    expect(formLabel(1.5)).toBe('In Top Form!');
    expect(formLabel(1.2)).toBe('In Good Form');
    expect(formLabel(1.0)).toBe('Steady');
    expect(formLabel(0.7)).toBe('Off Day');
    expect(formLabel(0.4)).toBe('Terrible Day');
  });
});
