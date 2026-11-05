export type Theme = "system" | "light" | "dark";
export type TextSize = "small" | "normal" | "large";
export type FontChoice = "system" | "readable";
export interface Appearance {
  theme: Theme;
  size: TextSize;
  font: FontChoice;
}

const KEY = "ml.appearance";
export const DEFAULT_APPEARANCE: Appearance = { theme: "system", size: "normal", font: "system" };
export const ZOOM: Record<TextSize, number> = { small: 0.92, normal: 1, large: 1.15 };

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);

/** Accepts anything stored earlier; unknown values fall back to the defaults. */
export function parseAppearance(raw: string | null): Appearance {
  try {
    const o = raw ? JSON.parse(raw) : {};
    return {
      theme: oneOf(o.theme, ["system", "light", "dark"] as const, "system"),
      size: oneOf(o.size, ["small", "normal", "large"] as const, "normal"),
      font: oneOf(o.font, ["system", "readable"] as const, "system"),
    };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function loadAppearance(): Appearance {
  try {
    return parseAppearance(localStorage.getItem(KEY));
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

/** Applies the choice to the page. The overlay window keeps its own clear look. */
export function applyAppearance(a: Appearance, root: { dataset: DOMStringMap; style: { zoom: string } } = document.documentElement) {
  if (a.theme === "system") delete root.dataset.theme;
  else root.dataset.theme = a.theme;
  root.dataset.font = a.font;
  root.style.zoom = String(ZOOM[a.size]);
}

export function saveAppearance(a: Appearance) {
  try {
    localStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    /* choice still applies for this run */
  }
  applyAppearance(a);
}
