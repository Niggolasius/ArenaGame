import { describe, expect, it } from 'vitest';
import { cloneConfig, DEFAULT_CONFIG } from '../src/sim/config';
import { makeGladiator, makeItem, makeStone } from '../src/sim/factory';
import { claimMail, collectMine, fightReport, newGame, placeFromInventory, postFight, tickGame, unreadCount } from '../src/sim/game';
import { entryRarity, rarityRank, rollBonusLoot, sortForReveal } from '../src/sim/loot';
import { collectPlot, emptyPlot, expectedPerRun, makeMineCard, mineRunDrops, mineStatus, placeCard, tickPlot } from '../src/sim/mine';
import { mulberry32 } from '../src/sim/rng';

const cfg = DEFAULT_CONFIG;

describe('Mine', () => {
  it('ein Durchgang dauert cycleSeconds, das Ergebnis hängt nur von Karte und Nummer ab', () => {
    const card = makeMineCard('common', cfg, 42);
    const p = emptyPlot();
    placeCard(p, card);
    expect(tickPlot(p, cfg.mine.cycleSeconds - 0.01, cfg)).toHaveLength(0);
    const done = tickPlot(p, 0.02, cfg);
    expect(done).toHaveLength(1);
    expect(done[0]).toEqual(mineRunDrops(makeMineCard('common', cfg, 42), 0, cfg).map((e) => (e.kind === 'stone' ? { ...e, stone: { ...e.stone, id: expect.any(String) } } : e)));
    expect(card.runsLeft).toBe(cfg.mine.cards.common.runs - 1);
  });

  it('volles Lager: Stillstand ohne Verschleiß, nach dem Abholen läuft sie weiter', () => {
    const card = makeMineCard('epic', cfg, 7);
    const p = emptyPlot();
    placeCard(p, card);
    tickPlot(p, cfg.mine.cycleSeconds * 100, cfg);
    expect(p.storage).toHaveLength(cfg.mine.storageRuns);
    expect(mineStatus(p, cfg)).toBe('full');
    expect(card.runsLeft).toBe(cfg.mine.cards.epic.runs - cfg.mine.storageRuns);
    tickPlot(p, 1000, cfg);
    expect(card.runsLeft).toBe(cfg.mine.cards.epic.runs - cfg.mine.storageRuns);
    const { runs, loot } = collectPlot(p);
    expect(runs).toBe(cfg.mine.storageRuns);
    expect(loot.length).toBeGreaterThan(0);
    expect(mineStatus(p, cfg)).toBe('running');
  });

  it('Karte ist nach `runs` Durchgängen verbraucht', () => {
    const c = cloneConfig(cfg);
    c.mine.storageRuns = 10_000;
    const card = makeMineCard('common', c, 1);
    const p = emptyPlot();
    placeCard(p, card);
    tickPlot(p, c.mine.cycleSeconds * 1000, c);
    expect(card.runsLeft).toBe(0);
    expect(p.storage).toHaveLength(c.mine.cards.common.runs);
    expect(mineStatus(p, c)).toBe('worn');
  });

  it('erwartete Menge passt zur Simulation', () => {
    const def = cfg.mine.cards.mythic;
    const exp = expectedPerRun(def);
    let iron = 0;
    const N = 20000;
    const card = makeMineCard('mythic', cfg, 99);
    for (let i = 0; i < N; i++) for (const e of mineRunDrops(card, i, cfg)) if (e.kind === 'res' && e.res === 'iron') iron += e.n;
    expect(iron / N).toBeCloseTo(exp.res.iron!, 1);
  });
});

describe('Loot und Postfach', () => {
  const a = makeGladiator({ name: 'A', style: 'heavy', base: { atk: 9, def: 9, hp: 9, spd: 9 } });
  const b = makeGladiator({
    name: 'B',
    style: 'swift',
    base: { atk: 3, def: 3, hp: 3, spd: 3 },
    items: [makeItem('weapon', 'epic', { atk: 2 }, 1, [makeStone('epic', { type: 'crit' })]), makeItem('armor', 'rare', { def: 1 })],
  });

  it('Aufdecken: das Seltenste zuletzt', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 50; i++) {
      const loot = sortForReveal(rollBonusLoot(rng, 'champion', cfg));
      for (let j = 1; j < loot.length; j++) expect(rarityRank(entryRarity(loot[j]))).toBeGreaterThanOrEqual(rarityRank(entryRarity(loot[j - 1])));
    }
  });

  it('Bonus-Steine folgen der Arena-Klasse', () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 200; i++) {
      for (const e of rollBonusLoot(rng, 'bronze', cfg)) if (e.kind === 'stone') expect(['common', 'rare']).toContain(e.stone.rarity);
    }
  });

  it('Kampfbericht ist deterministisch, Sieg bringt Pott minus Arena-Anteil', () => {
    const r1 = fightReport(a, b, 11, cfg, 'kill');
    const r2 = fightReport(a, b, 11, cfg, 'kill');
    expect(r1.playerWon).toBe(true);
    expect(r1.lines).toEqual(r2.lines);
    expect(r1.bonus.map(entryRarity)).toEqual(r2.bonus.map(entryRarity));
    const stake = cfg.arena.classes.find((c) => c.id === r1.classId)!.stake;
    expect(r1.payout).toBe(Math.round(2 * stake * (1 - cfg.arena.arenaShare)));
    expect(r1.gear.length + r1.trashed.length).toBe(2); // beide echten Items: behalten oder zerstört
  });

  it('Niederlage: Einsatz weg, kein Loot', () => {
    const r = fightReport(b, a, 11, cfg, 'gold');
    expect(r.playerWon).toBe(false);
    expect(r.bonus).toHaveLength(0);
    expect(r.payout).toBe(0);
    expect(r.paidNow).toBeGreaterThan(r.stake);
  });

  it('Postfach: Titel ohne Ergebnis, rote Zahl, Abholen legt alles ins Inventar, nichts verfällt', () => {
    const g = newGame(cfg, 0);
    const before = g.silver;
    const m = postFight(g, a, b, 11, cfg, 'kill', Infinity, { now: 0 });
    expect(m.title).not.toMatch(/victory|defeat|won|lost/i);
    expect(m.revealed).toBe(false);
    expect(unreadCount(g, 'fight')).toBe(1);
    expect(g.silver).toBeLessThan(before);
    const stones = g.stones.length;
    claimMail(g, m);
    expect(g.silver).toBe(before - fightReport(a, b, 11, cfg, 'kill').paidNow + m.silver);
    expect(g.stones.length).toBe(stones + m.loot.filter((e) => e.kind === 'stone').length);
    expect(unreadCount(g, 'fight')).toBe(0);
    expect(claimMail(g, m)).toBe(false); // nicht doppelt
    expect(g.mail).toContain(m); // bleibt liegen
  });

  it('Mine → Postfach → Inventar, Karte aus dem Begrüßungsbrief platzieren', () => {
    const g = newGame(cfg, 0);
    claimMail(g, g.mail[0]);
    expect(g.cards).toHaveLength(1);
    expect(placeFromInventory(g, 1, g.cards[0].id)).toBe(true);
    tickGame(g, cfg.mine.cycleSeconds * 3 + 0.1, cfg);
    expect(g.plots[0].storage).toHaveLength(3);
    expect(g.plots[1].storage).toHaveLength(3);
    const mail = collectMine(g, 0, cfg, 0)!;
    expect(mail.kind).toBe('mine');
    const copper = g.res.copper ?? 0;
    claimMail(g, mail);
    expect(g.res.copper ?? 0).toBeGreaterThan(copper);
  });
});
