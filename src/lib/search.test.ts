import { describe, expect, it } from "vitest";
import { countMatches, filterSegments, splitHighlight } from "./search";
import type { Segment } from "./types";

const seg = (id: number, text: string) => ({ id, text, source: "system", start_ms: 0, end_ms: 1 }) as unknown as Segment;
const all = [seg(1, "We ship Friday"), seg(2, "Budget is approved"), seg(3, "friday demo")];

describe("transcript search", () => {
  it("matches case-insensitively and keeps order", () => {
    expect(filterSegments(all, "FRIDAY").map((s) => s.id)).toEqual([1, 3]);
    expect(countMatches(all, "friday")).toBe(2);
  });
  it("an empty or blank query shows everything and counts nothing", () => {
    expect(filterSegments(all, "  ")).toHaveLength(3);
    expect(countMatches(all, "")).toBe(0);
  });
  it("splits text around each match", () => {
    expect(splitHighlight("a Fri b fri", "fri")).toEqual([
      { text: "a ", hit: false }, { text: "Fri", hit: true }, { text: " b ", hit: false }, { text: "fri", hit: true },
    ]);
  });
});
