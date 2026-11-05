import { describe, expect, it } from "vitest";
import { pendingNotes } from "./SimpleStream";

describe("pendingNotes", () => {
  it("lists notes not yet shown", () => {
    expect(pendingNotes([1, 3, 4], [1])).toEqual([3, 4]);
  });
  it("does not list a note that was skipped (stored as -id-1), so the reveal cannot loop", () => {
    expect(pendingNotes([1, 3, 4], [-1 - 1, 4])).toEqual([3]);
    expect(pendingNotes([1, 3, 4], [-2, -4, -5])).toEqual([]);
  });
});
