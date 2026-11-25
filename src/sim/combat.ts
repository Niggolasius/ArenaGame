// Die Kampf-Simulation. Feste Ticks und ein Seed: gleiche Eingaben ergeben immer denselben Kampf.
//
// Aufbau, damit die Formel K = sqrt((ATK + SPD/2) * (DEF + HP)) im Mittel stimmt:
// - Schaden pro Sekunde ist proportional zu ATK + SPD/2
//   (Treffer = dmgPerAtk * ATK, Tempo = attacksPerSecond * (1 + SPD / (2 * ATK))).
// - Effektive Lebenspunkte sind proportional zu DEF + HP
//   (max HP = hpPerPoint * HP, erlittener Schaden * HP / (HP + DEF)).
// Wer mehr K hat, gewinnt im Schnitt. Zufall (Streuung, Krit, Ausweichen) macht daraus eine Wahrscheinlichkeit.

import type { Config } from './config';
import { mulberry32 } from './rng';
import { effectiveStats, specialStones } from './stats';
import type { FightEvent, FightResult, Gladiator, Stance } from './types';

const BEATS: Record<Stance, Stance> = {
  aggressiv: 'ausweichend',
  ausweichend: 'defensiv',
  defensiv: 'aggressiv',
};

interface Fighter {
  maxHp: number;
  hp: number;
  hitDmg: number;
  interval: number;
  next: number;
  dmgMult: number;
  takenMult: number;
  dodge: number;
  crit: number;
  lifesteal: number;
  thorns: number;
  zorn: number;
  firstStrike: boolean;
  lastStand: 'normal' | 'alles' | 'durchhalten';
  inLastStand: boolean;
  hits: number;
}

function build(g: Gladiator, foe: Gladiator, cfg: Config): Fighter {
  const s = effectiveStats(g, cfg);
  const style = cfg.styles[g.style];
  const stance = cfg.stances[g.orders.stance];
  const specials = specialStones(g, cfg);
  const foeSpecials = specialStones(foe, cfg);
  const has = (t: string) => specials.find((x) => x.kind.type === t);

  let dmgMult = stance.dmg;
  if (BEATS[g.orders.stance] === foe.orders.stance) dmgMult *= cfg.counterDmg;
  if (style.prefers === g.orders.distance) dmgMult *= 1 + cfg.distanceBonus;
  if (foeSpecials.some((x) => x.kind.type === 'fluch')) dmgMult *= cfg.stones.fluch;

  const krit = has('krit');
  const blut = has('blutdurst');
  const rate = cfg.sim.attacksPerSecond * (1 + s.spd / (2 * s.atk)) * style.rate;
  const maxHp = cfg.sim.hpPerPoint * s.hp;

  return {
    maxHp,
    hp: maxHp,
    hitDmg: cfg.sim.dmgPerAtk * s.atk * style.dmg,
    interval: 1 / rate,
    next: 0,
    dmgMult,
    takenMult: stance.taken * (s.hp / (s.hp + s.def)),
    dodge: Math.min(cfg.sim.dodgeCap, cfg.sim.dodgeChance + stance.dodge),
    crit: Math.min(cfg.sim.critCap, cfg.sim.critChance + (krit ? cfg.stones.krit[krit.rarity] ?? 0 : 0)),
    lifesteal: blut ? cfg.stones.blutdurst[blut.rarity] ?? 0 : 0,
    thorns: has('dornen') ? cfg.stones.dornen : 0,
    zorn: has('zorn') ? cfg.stones.zornMax : 0,
    firstStrike: !!has('erstschlag'),
    lastStand: g.orders.lastStand,
    inLastStand: false,
    hits: 0,
  };
}

export interface SimOptions {
  events?: boolean;
}

export function simulate(a: Gladiator, b: Gladiator, seed: number, cfg: Config, opts: SimOptions = {}): FightResult {
  const rng = mulberry32(seed);
  const f: [Fighter, Fighter] = [build(a, b, cfg), build(b, a, cfg)];
  const events: FightEvent[] | undefined = opts.events ? [] : undefined;
  const tps = cfg.sim.ticksPerSecond;
  const maxTicks = Math.round(cfg.sim.maxSeconds * tps);

  // Erstschlag: halber Start-Versatz. Ein ganz sofortiger Start machte schnelle Glaskanonen übermächtig.
  for (const x of f) x.next = rng() * cfg.sim.startDelayMax * (x.firstStrike ? 0.5 : 1);
  // Tagesform: ein Zufallsfaktor pro Kampf auf den Schaden. Er sorgt für Überraschungen trotz klarer Stats.
  const form = [0, 1].map(() => 1 + cfg.sim.formSpread * (2 * rng() - 1)) as [number, number];
  f[0].dmgMult *= form[0];
  f[1].dmgMult *= form[1];

  const lsMod = (x: Fighter) => (x.inLastStand && x.lastStand !== 'normal' ? cfg.lastStand[x.lastStand] : null);

  const checkLastStand = (i: 0 | 1, t: number) => {
    const x = f[i];
    if (!x.inLastStand && x.hp > 0 && x.hp <= x.maxHp * cfg.lastStand.threshold) {
      x.inLastStand = true;
      events?.push({ t, type: 'laststand', who: i });
    }
  };

  const attack = (i: 0 | 1, t: number): boolean => {
    const att = f[i];
    const j = (1 - i) as 0 | 1;
    const def = f[j];
    const first = att.hits === 0 && att.firstStrike;
    att.hits++;
    if (!first && rng() < def.dodge) {
      events?.push({ t, type: 'dodge', from: i });
      return false;
    }
    const crit = rng() < att.crit;
    let dmg = att.hitDmg * att.dmgMult * (1 + cfg.sim.dmgSpread * (2 * rng() - 1));
    if (crit) dmg *= cfg.sim.critMult;
    if (att.zorn) dmg *= 1 + att.zorn * (1 - att.hp / att.maxHp);
    const la = lsMod(att);
    if (la) dmg *= la.dmg;
    dmg *= def.takenMult;
    // Wuchttreffer: Chance pro Angriff skaliert mit dem Angriffsabstand, also gleich oft pro Sekunde für jeden.
    const lucky = cfg.sim.luckyChance > 0 && rng() < cfg.sim.luckyChance * att.interval * cfg.sim.attacksPerSecond;
    if (lucky) dmg += def.maxHp * cfg.sim.luckyHpFrac;
    // Erstschlag: fester Anteil der gegnerischen HP, damit er bei jeder Bauart ähnlich viel wert ist.
    if (first) dmg += def.maxHp * cfg.stones.erstschlagHpFrac;
    const ld = lsMod(def);
    if (ld) dmg *= ld.taken;
    const d = Math.max(1, Math.round(dmg));
    def.hp = Math.max(0, def.hp - d);
    events?.push({ t, type: 'hit', from: i, dmg: d, crit, lucky, hpLeft: def.hp });

    if (att.lifesteal && att.hp > 0) {
      const heal = Math.round(d * att.lifesteal);
      if (heal > 0) {
        att.hp = Math.min(att.maxHp, att.hp + heal);
        events?.push({ t, type: 'heal', who: i, amount: heal, hpLeft: att.hp });
      }
    }
    if (def.thorns && def.hp > 0) {
      const back = Math.round(d * def.thorns);
      if (back > 0) {
        att.hp = Math.max(0, att.hp - back);
        events?.push({ t, type: 'thorns', who: i, dmg: back, hpLeft: att.hp });
      }
    }
    checkLastStand(j, t);
    checkLastStand(i, t);
    return def.hp <= 0 || att.hp <= 0;
  };

  let tick = 0;
  let winner: 0 | 1 | null = null;
  let reason: 'ko' | 'zeit' = 'ko';
  for (; tick <= maxTicks && winner === null; tick++) {
    const t = tick / tps;
    // Wer zuerst dran ist, entscheidet bei Gleichstand der Zufall.
    const order: (0 | 1)[] = rng() < 0.5 ? [0, 1] : [1, 0];
    for (const i of order) {
      while (winner === null && f[i].next <= t) {
        f[i].next += f[i].interval;
        if (attack(i, t)) {
          // Doppel-KO durch Dornen: wer noch HP hat, gewinnt, sonst der Angreifer verliert.
          const j = (1 - i) as 0 | 1;
          winner = f[j].hp <= 0 && f[i].hp > 0 ? i : f[i].hp <= 0 && f[j].hp > 0 ? j : j;
        }
      }
    }
  }
  if (winner === null) {
    reason = 'zeit';
    const pa = f[0].hp / f[0].maxHp;
    const pb = f[1].hp / f[1].maxHp;
    winner = pa === pb ? (rng() < 0.5 ? 0 : 1) : pa > pb ? 0 : 1;
  }
  const seconds = Math.min(tick, maxTicks) / tps;
  events?.push({ t: seconds, type: 'end', winner, reason });

  return {
    winner,
    ticks: tick,
    seconds,
    hpLeft: [f[0].hp, f[1].hp],
    maxHp: [f[0].maxHp, f[1].maxHp],
    hits: [f[0].hits, f[1].hits],
    form,
    events,
  };
}
