/** Share (in percent) of the first pane, kept between sensible bounds. */
export const MIN_SPLIT = 25;
export const MAX_SPLIT = 75;
export const DEFAULT_SPLIT = 45;
const KEY = "ml.split";

export function clampSplit(pct: number): number {
  if (!Number.isFinite(pct)) return DEFAULT_SPLIT;
  return Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, Math.round(pct * 10) / 10));
}

/** Percent for a pointer position inside a box. */
export function splitFromPointer(x: number, left: number, width: number): number {
  if (width <= 0) return DEFAULT_SPLIT;
  return clampSplit(((x - left) / width) * 100);
}

export function loadSplit(): number {
  try {
    const v = localStorage.getItem(KEY);
    return v === null ? DEFAULT_SPLIT : clampSplit(Number(v));
  } catch {
    return DEFAULT_SPLIT;
  }
}

export function saveSplit(v: number) {
  try {
    localStorage.setItem(KEY, String(v));
  } catch {
    /* not essential */
  }
}
