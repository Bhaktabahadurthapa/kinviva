import { describe, expect, it } from "vitest";
import { applyAppearance, DEFAULT_APPEARANCE, parseAppearance } from "./appearance";

describe("appearance", () => {
  it("falls back to defaults for missing or damaged data", () => {
    expect(parseAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance("{nope")).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance('{"theme":"neon","size":"huge"}')).toEqual(DEFAULT_APPEARANCE);
  });
  it("keeps valid choices", () => {
    expect(parseAppearance('{"theme":"dark","size":"large","font":"readable"}')).toEqual({ theme: "dark", size: "large", font: "readable" });
  });
  it("sets data attributes; system leaves the theme to the OS", () => {
    const el = { dataset: {} as DOMStringMap, style: { zoom: "" } };
    applyAppearance({ theme: "dark", size: "large", font: "readable" }, el);
    expect(el.dataset.theme).toBe("dark");
    expect(el.dataset.font).toBe("readable");
    applyAppearance({ theme: "system", size: "normal", font: "system" }, el);
    expect(el.dataset.theme).toBeUndefined();
  });
});
