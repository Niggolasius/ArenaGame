// Sprite-Sheets der Gladiatoren. Hier wird festgelegt, welches Bild welche Figur nutzt
// und wo im Bild welche Animation liegt. Eigene Grafiken oder Asset-Packs einbauen:
//   1. PNG nach public/sprites/ legen (z. B. public/sprites/heavy.png).
//   2. Unten bei der Figur `src: 'sprites/heavy.png'` eintragen.
//   3. frameW/frameH, anchor und die Zeilen/Bildzahlen an das Sheet anpassen.
// Ohne `src` zeichnet das Spiel einen Platzhalter, der genau dieses Raster nutzt.
// Im Test-Tool (Tab „Arena“) lässt sich jeder Platzhalter als Vorlage herunterladen.

import type { Style } from '../sim/types';

export interface AnimDef {
  row: number; // Zeile im Sheet, ab 0
  frames: number; // Bilder in dieser Zeile, von links
  fps: number;
  loop?: boolean;
  /** Angriff: Bild, in dem die Waffe trifft. Darauf wird der Treffer der Simulation gelegt. */
  hitFrame?: number;
  /** Tod: Bild, in dem die Figur kniet (für den Mercy-Moment). Ohne Angabe: Bild 1. */
  kneelFrame?: number;
}

export interface SpriteDef {
  src?: string; // Pfad relativ zu public/, ohne Angabe Platzhalter
  frameW: number;
  frameH: number;
  /** Fußpunkt im Bild: dort steht die Figur auf dem Boden. */
  anchorX: number;
  anchorY: number;
  /** In welche Richtung die Figur im Sheet schaut. Die rechte Figur wird gespiegelt. */
  facing: 'right' | 'left';
  anims: {
    idle: AnimDef;
    walk: AnimDef;
    attack: AnimDef;
    hit: AnimDef;
    death: AnimDef;
    /** Arm hochreißen. Fehlt es, nutzt das Spiel idle. */
    cheer?: AnimDef;
    /** Hand reichen (ehrenvoll verschonen). Fehlt es, nutzt das Spiel idle. */
    help?: AnimDef;
    /** Tod ohne Kopf (Heavy-Finisher). Fehlt es, nutzt das Spiel death. */
    deathHeadless?: AnimDef;
  };
  /** Einzelbild mit dem Kopf allein (fliegt beim Köpfen). Fehlt es, fliegt kein Kopf. */
  head?: { row: number; frame: number };
}

/** Raster der Platzhalter. Ein eigenes Sheet kann genauso aufgebaut sein, muss es aber nicht. */
const PLACEHOLDER_LAYOUT: Omit<SpriteDef, 'src'> = {
  frameW: 32,
  frameH: 32,
  anchorX: 16,
  anchorY: 30,
  facing: 'right',
  anims: {
    idle: { row: 0, frames: 4, fps: 6, loop: true },
    walk: { row: 1, frames: 6, fps: 11, loop: true },
    attack: { row: 2, frames: 6, fps: 15, hitFrame: 3 },
    hit: { row: 3, frames: 3, fps: 14 },
    death: { row: 4, frames: 7, fps: 10, kneelFrame: 2 },
    cheer: { row: 5, frames: 4, fps: 8, loop: true },
    help: { row: 6, frames: 2, fps: 4 },
    deathHeadless: { row: 8, frames: 7, fps: 10, kneelFrame: 2 },
  },
  head: { row: 7, frame: 0 },
};

/** Eine Figur pro Kampfstil. Hier eigene Sheets eintragen. */
export const SPRITES: Record<Style, SpriteDef> = {
  heavy: { ...PLACEHOLDER_LAYOUT },
  swift: { ...PLACEHOLDER_LAYOUT },
  spear: { ...PLACEHOLDER_LAYOUT },
};

export const ROW_NAMES = ['idle', 'walk', 'attack', 'hit', 'death', 'cheer', 'help', 'head', 'deathHeadless'];

/**
 * Der Arbeiter in der Mine. Gleiches Prinzip wie bei den Gladiatoren: ohne `src` Platzhalter.
 * Zeile 0 Schlag mit der Spitzhacke (`hitFrame` = Aufprall, liegt im Takt des Durchgangs),
 * Zeile 1 Sitzen/Schlafen (volles Lager), Zeile 2 Stehen. Ein Pet statt Arbeiter geht genauso.
 */
export interface MinerDef {
  src?: string;
  frameW: number;
  frameH: number;
  anchorX: number;
  anchorY: number;
  anims: { swing: AnimDef; rest: AnimDef; idle: AnimDef };
}
export const MINER: MinerDef = {
  frameW: 32,
  frameH: 32,
  anchorX: 16,
  anchorY: 30,
  anims: {
    swing: { row: 0, frames: 6, fps: 0, hitFrame: 4 }, // fps egal: Takt kommt vom Durchgang
    rest: { row: 1, frames: 2, fps: 1.5, loop: true },
    idle: { row: 2, frames: 2, fps: 2, loop: true },
  },
};
