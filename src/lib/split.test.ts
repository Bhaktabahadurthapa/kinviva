import { describe, expect, it } from "vitest";
import { clampSplit, DEFAULT_SPLIT, MAX_SPLIT, MIN_SPLIT, splitFromPointer } from "./split";

describe("split", () => {
  it("keeps both panels usable", () => {
    expect(clampSplit(2)).toBe(MIN_SPLIT);
    expect(clampSplit(99)).toBe(MAX_SPLIT);
    expect(clampSplit(NaN)).toBe(DEFAULT_SPLIT);
  });
  it("maps the pointer to a percentage of the box", () => {
    expect(splitFromPointer(300, 100, 400)).toBe(50);
    expect(splitFromPointer(0, 100, 400)).toBe(MIN_SPLIT);
    expect(splitFromPointer(50, 0, 0)).toBe(DEFAULT_SPLIT);
  });
});
