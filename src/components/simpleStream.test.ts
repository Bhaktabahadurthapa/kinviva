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

import { dropRepeats, similarText } from "./SimpleStream";
describe("repeated explanations", () => {
  const a = "An agentic loop lets the AI try, check results, and try again. This iterative process replaces one perfect complex search.";
  const b = "The agentic loop lets AI try, check the results, and try again. This iterative process replaces the need for one perfect complex search.";
  it("recognises near-identical explanations and ignores different ones", () => {
    expect(similarText(a, b)).toBe(true);
    expect(similarText(a, "Latency is the time a request waits before a server starts answering it.")).toBe(false);
    expect(similarText("short", "short")).toBe(false);
  });
  it("keeps the first of a run of repeats and never drops answers or unfinished notes", () => {
    const text: Record<number, string | null> = { 1: a, 2: b, 3: "Latency is the time a request waits before a server starts answering it.", 4: null, 5: a };
    expect(dropRepeats([1, 2, 3, 4, 5], (id) => text[id])).toEqual([1, 3, 4, 5]);
  });
});
