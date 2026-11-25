// Speichern im Browser. localStorage kann fehlen oder voll sein, darum alles in try/catch.

import { cloneConfig, DEFAULT_CONFIG, type Config } from '../sim/config';

const KEY_CFG = 'arenagame.tool.config.v1';
const KEY_STATE = 'arenagame.tool.state.v1';

/** Legt gespeicherte Werte über die Standardwerte, damit neue Felder aus Updates nicht fehlen. */
export function mergeConfig(base: unknown, over: unknown): unknown {
  if (Array.isArray(base)) return Array.isArray(over) ? over : base;
  if (base && typeof base === 'object') {
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    if (over && typeof over === 'object' && !Array.isArray(over)) {
      for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
        out[k] = k in out ? mergeConfig(out[k], v) : v;
      }
    }
    return out;
  }
  return typeof over === typeof base ? over : base;
}

export function loadConfig(): Config {
  try {
    const raw = localStorage.getItem(KEY_CFG);
    if (raw) return mergeConfig(cloneConfig(DEFAULT_CONFIG), JSON.parse(raw)) as Config;
  } catch {
    /* ohne Speicher geht es mit den Standardwerten weiter */
  }
  return cloneConfig(DEFAULT_CONFIG);
}

export function saveConfig(c: Config) {
  try {
    localStorage.setItem(KEY_CFG, JSON.stringify(c));
  } catch {
    /* egal */
  }
}

export function loadState<T>(): T | null {
  try {
    const raw = localStorage.getItem(KEY_STATE);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function saveState(s: unknown) {
  try {
    localStorage.setItem(KEY_STATE, JSON.stringify(s));
  } catch {
    /* egal */
  }
}
