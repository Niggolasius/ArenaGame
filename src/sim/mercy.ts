// Der Mercy-Moment nach dem Kampf, ohne Grafik: Publikumsabstimmung, Bestechung und Folgen der Entscheidung.
// Alles hängt nur vom Kampf und vom Seed ab, darum sieht ein Replay genauso aus.

import type { Config } from './config';
import type { MercyChoice } from './names';
import { deriveSeed, mulberry32 } from './rng';
import { arenaClass, power } from './stats';
import type { FightResult, Gladiator } from './types';

export interface Vote {
  seat: number; // Platz im Publikum (für die Darstellung)
  t: number; // Sekunden nach Beginn der Abstimmung
  spare: boolean;
}

export interface MercySetup {
  classId: string;
  stake: number; // Silber
  spectators: number;
  npc: boolean; // keine echten Zuschauer: kleines NPC-Publikum
  voteSeconds: number; // wann die Abstimmung spätestens fertig ist
  votes: Vote[]; // nur wer abstimmt, nach Zeit sortiert
  bribe: number; // Angebot des Verlierers in Silber
  spareChance: number; // Chance pro Zuschauer auf Daumen hoch
  closeness: number; // 0 = einseitig, 1 = denkbar knapp
}

export interface MercyOutcome {
  choice: MercyChoice;
  spareVotes: number;
  killVotes: number;
  majority: 'spare' | 'kill' | 'tie';
  followed: boolean | null; // null bei Gleichstand
  fame: number; // Ruhm des Siegers
  gold: number; // Silber für den Sieger
  honor: number;
  butcher: number;
  loserDies: boolean;
  scar: number; // Stat-Malus für den Verlierer, wenn er lebt
}

/** Wie knapp war der Kampf? Aus den Rest-HP des Siegers: voll = einseitig, fast leer = knapp. */
export function closeness(r: FightResult): number {
  const w = r.winner;
  return Math.max(0, Math.min(1, 1 - r.hpLeft[w] / r.maxHp[w]));
}

export function setupMercy(a: Gladiator, b: Gladiator, r: FightResult, seed: number, cfg: Config): MercySetup {
  const rng = mulberry32(deriveSeed(seed, 7001));
  const m = cfg.mercy;
  // Die Klasse richtet sich nach dem Stärkeren, wie bei der Paarung.
  const cls = arenaClass(Math.max(power(a, cfg), power(b, cfg)), cfg);
  const real = Math.max(0, Math.round(m.spectators[cls.id] ?? 60));
  const npc = real === 0;
  const spectators = npc ? Math.max(0, Math.round(m.npcCrowd)) : real;
  const voteSeconds = npc ? m.npcVoteSeconds : m.voteSeconds;
  const c = closeness(r);
  const spareChance = Math.max(0.05, Math.min(0.95, m.spareBase + m.spareCloseness * c));
  const votes: Vote[] = [];
  for (let seat = 0; seat < spectators; seat++) {
    const abstains = rng() < m.abstain;
    const spare = rng() < spareChance;
    // Die meisten stimmen früh ab, ein paar warten bis zum Schluss: so bleibt es spannend.
    const t = Math.min(0.3, voteSeconds * 0.1) + Math.pow(rng(), 1.6) * voteSeconds * 0.85;
    if (!abstains) votes.push({ seat, t, spare });
  }
  votes.sort((x, y) => x.t - y.t);
  const frac = m.bribeMin + rng() * (m.bribeMax - m.bribeMin);
  const bribe = Math.max(1, Math.round(cls.stake * frac));
  return { classId: cls.id, stake: cls.stake, spectators, npc, voteSeconds, votes, bribe, spareChance, closeness: c };
}

export function tally(votes: Vote[], untilT = Infinity) {
  let spare = 0;
  let kill = 0;
  for (const v of votes) {
    if (v.t > untilT) break;
    if (v.spare) spare++;
    else kill++;
  }
  return { spare, kill };
}

/**
 * Folgen der Entscheidung. `atT`: Sekunden nach Beginn der Abstimmung. Wer früh entscheidet,
 * bekommt Ruhm nur für die Stimmen, die bis dahin abgegeben wurden.
 */
export function resolveMercy(setup: MercySetup, choice: MercyChoice, cfg: Config, atT = Infinity): MercyOutcome {
  const { spare, kill } = tally(setup.votes, atT);
  const majority = spare > kill ? 'spare' : kill > spare ? 'kill' : 'tie';
  const spared = choice !== 'kill';
  const followed = majority === 'tie' ? null : (majority === 'spare') === spared;
  const voters = spare + kill;
  const fame = followed === null ? 0 : (followed ? 1 : -1) * cfg.mercy.famePerVoter * voters;
  return {
    choice,
    spareVotes: spare,
    killVotes: kill,
    majority,
    followed,
    fame,
    gold: choice === 'gold' ? setup.bribe : 0,
    honor: choice === 'honor' ? 1 : 0,
    butcher: choice === 'kill' ? 1 : 0,
    loserDies: !spared,
    scar: spared ? cfg.mercy.scar : 0,
  };
}
