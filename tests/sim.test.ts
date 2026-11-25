import { describe, expect, it } from 'vitest';
import { massSim } from '../src/sim/analysis';
import { simulate } from '../src/sim/combat';
import { cloneConfig, DEFAULT_CONFIG } from '../src/sim/config';
import { even, makeGladiator, makeItem, makeStone, withStone } from '../src/sim/factory';
import { arenaClass, effectiveStats, formulaP, kFactorFromP, power, rawPower, specialStones } from '../src/sim/stats';
import { mergeConfig } from '../src/tool/store';

const cfg = DEFAULT_CONFIG;

describe('Simulation', () => {
  it('gleicher Seed ergibt denselben Kampf', () => {
    const a = makeGladiator({ base: { atk: 7, def: 5, hp: 6, spd: 4 }, style: 'heavy' });
    const b = makeGladiator({ base: { atk: 5, def: 6, hp: 7, spd: 8 }, style: 'swift' });
    const r1 = simulate(a, b, 42, cfg, { events: true });
    const r2 = simulate(a, b, 42, cfg, { events: true });
    expect(r2).toEqual(r1);
    const others = [1, 2, 3, 4, 5].map((s) => JSON.stringify(simulate(a, b, s, cfg, { events: true }).events));
    expect(new Set(others).size).toBeGreaterThan(1);
  });

  it('jeder Kampf endet mit genau einem Sieger und einem end-Ereignis', () => {
    const a = makeGladiator({ base: even(5) });
    const r = simulate(a, a, 7, cfg, { events: true });
    expect([0, 1]).toContain(r.winner);
    expect(r.events?.at(-1)?.type).toBe('end');
  });

  it('Spiegelkampf ist ausgeglichen', () => {
    const a = makeGladiator({ base: even(6) });
    const m = massSim(a, a, 6000, 3, cfg);
    expect(Math.abs(m.p - 0.5)).toBeLessThan(0.03);
  });

  it('Messung passt zur Formel (höchstens 3 pp)', () => {
    const a = makeGladiator({ base: even(8) });
    const b = makeGladiator({ base: even(7) });
    const m = massSim(a, b, 8000, 5, cfg);
    expect(Math.abs(m.p - formulaP(power(a, cfg), power(b, cfg), cfg.formulaExponent))).toBeLessThan(0.03);
  });

  it('10.000 Kämpfe in unter 10 Sekunden', () => {
    const a = makeGladiator({ base: even(7) });
    const t = performance.now();
    massSim(a, makeGladiator({ base: even(6) }), 10000, 1, cfg);
    expect(performance.now() - t).toBeLessThan(10000);
  });
});

describe('Stats und Kraft', () => {
  it('K = sqrt((ATK + SPD/2) * (DEF + HP))', () => {
    expect(rawPower({ atk: 6, def: 5, hp: 7, spd: 4 })).toBeCloseTo(Math.sqrt(8 * 12));
  });

  it('Ausrüstung und Grundsteine zählen, begrenzt auf statCap', () => {
    const g = makeGladiator({
      base: { atk: 10, def: 5, hp: 5, spd: 5 },
      items: [makeItem('weapon', 'rare', { atk: 2 }, 1, [makeStone('legendary', { type: 'base', stat: 'atk', value: 0 })])],
    });
    expect(effectiveStats(g, cfg).atk).toBe(cfg.statCap);
  });

  it('Steine ohne Sockel zählen nicht, höchstens ein Sonderstein', () => {
    const krit = makeStone('epic', { type: 'crit' });
    const blut = makeStone('legendary', { type: 'bloodthirst' });
    const g = makeGladiator({ base: even(5), items: [makeItem('amulet', 'epic', {}, 2, [krit, blut]), makeItem('weapon', 'epic', {}, 0, [krit])] });
    expect(specialStones(g, cfg)).toHaveLength(1);
    expect(power(g, cfg)).toBeCloseTo(rawPower(even(5)) * (cfg.kSurcharge.epic ?? 1));
  });

  it('Arena-Klassen nach K', () => {
    expect(arenaClass(7.9, cfg).id).toBe('bronze');
    expect(arenaClass(8, cfg).id).toBe('silver');
    expect(arenaClass(15.99, cfg).id).toBe('gold');
    expect(arenaClass(30, cfg).id).toBe('champion');
  });

  it('kFactorFromP kehrt formulaP um', () => {
    const p = formulaP(1.1, 1, 4);
    expect(kFactorFromP(p, 4)).toBeCloseTo(1.1, 5);
  });

  it('ein Sonderstein bringt etwa seinen eingestellten Aufschlag', () => {
    const base = makeGladiator({ base: even(8) });
    const a = withStone(base, makeStone('epic', { type: 'crit' }));
    const m = massSim(a, base, 20000, 9, cfg);
    expect(kFactorFromP(m.p, cfg.formulaExponent)).toBeCloseTo(cfg.kSurcharge.epic ?? 1, 1);
  });
});

describe('Einstellungen', () => {
  it('gespeicherte Config behält neue Felder aus Updates', () => {
    const old = cloneConfig(DEFAULT_CONFIG) as unknown as Record<string, unknown>;
    delete old.stoneTolerance;
    (old.sim as Record<string, unknown>).hpPerPoint = 999;
    const merged = mergeConfig(cloneConfig(DEFAULT_CONFIG), old) as typeof DEFAULT_CONFIG;
    expect(merged.sim.hpPerPoint).toBe(999);
    expect(merged.stoneTolerance).toBe(DEFAULT_CONFIG.stoneTolerance);
  });
});
