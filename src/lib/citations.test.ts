import { describe, expect, it } from "vitest";
import { citationText, resolveCitations } from "./citations";
import type { Passage } from "./types";

const ps: Passage[] = [
  { document: "week3.pdf", chunk: 0, text: "t", page: 4 },
  { document: "notes.md", chunk: 1, text: "t", page: null },
];

describe("citations", () => {
  it("names the file and page, or the part for text files", () => {
    expect(citationText(ps[0])).toBe("week3.pdf, p. 4");
    expect(citationText(ps[1])).toBe("notes.md, part 2");
  });
  it("resolves markers to real sources and flags invented ones", () => {
    expect(resolveCitations("Paging [S1]. More [S2]. Odd [S9] [S0].", ps)).toBe(
      "Paging [week3.pdf, p. 4]. More [notes.md, part 2]. Odd [unverified source] [unverified source].",
    );
    expect(resolveCitations("array[S] and [Sx] stay", ps)).toBe("array[S] and [Sx] stay");
    expect(resolveCitations("Claim [S1]", [])).toBe("Claim [unverified source]");
  });
});
