import { describe, expect, it } from "vitest";
import { citationText, displayText, normalizeAnswer, sourceLabels, spokenPart } from "./citations";
import type { Passage } from "./types";

const ps: Passage[] = [
  { document: "week3.pdf", chunk: 0, text: "t", page: 4 },
  { document: "notes.md", chunk: 1, text: "t", page: null },
];
const labels = ["week3.pdf, p. 4", "notes.md, part 2"];
const done = { kind: "section", complete: true } as const;

describe("citations", () => {
  it("names the file and page, or the part for text files", () => {
    expect(citationText(ps[0])).toBe("week3.pdf, p. 4");
    expect(citationText(ps[1])).toBe("notes.md, part 2");
  });

  it("labels put files before web results", () => {
    expect(sourceLabels({ sources: [ps[0]], web: [{ title: "Site", url: "https://example.com/a", snippet: "" }] })).toEqual(["week3.pdf, p. 4", "Site (example.com)"]);
  });

  it("lists only real sources in a SOURCES section and strips inline markers", () => {
    const text = "Round robin gives each process a slice [S1]. It prevents starvation [S2, S1].\n\nKEY TAKEAWAY\nFair sharing.\n\nSOURCES\n- [S2]\n- General knowledge: typical quantum sizes";
    const n = normalizeAnswer(text, labels, done);
    expect(n.text).not.toMatch(/\[S/);
    expect(n.text).toContain("slice. It prevents starvation.");
    expect(n.text.endsWith("SOURCES\n- week3.pdf, p. 4\n- notes.md, part 2\n- General knowledge: typical quantum sizes")).toBe(true);
    expect(n.cited).toEqual([0, 1]);
  });

  it("never shows an invented citation, file or page", () => {
    const n = normalizeAnswer("A claim [S9] and [S0] and [S3].\n\nSOURCES\n- [S7] fake.pdf, p. 99\n- Textbook p. 12", labels, done);
    expect(n.text).not.toMatch(/S9|fake\.pdf|p\. 99|Textbook/);
    expect(n.text.endsWith("SOURCES\nGeneral knowledge. The provided documents were not used.")).toBe(true);
    expect(normalizeAnswer("Answer [S1].", [], done).text.endsWith("General knowledge. No document was provided.")).toBe(true);
  });

  it("adds the SOURCES section only when the answer is complete", () => {
    expect(normalizeAnswer("Part one [S1]", labels, { kind: "section", complete: false }).text).toBe("Part one");
    expect(normalizeAnswer("Part one [S1]", labels, done).text).toBe("Part one\n\nSOURCES\n- week3.pdf, p. 4");
  });

  it("inline style resolves markers and drops invalid ones", () => {
    expect(normalizeAnswer("Paging [S1]. More [S2]. Odd [S9] ok.", labels, { kind: "inline" }).text).toBe("Paging [week3.pdf, p. 4]. More [notes.md, part 2]. Odd ok.");
    expect(normalizeAnswer("array[S] and [Sx] and [1]", labels, { kind: "inline" }).text).toBe("array[S] and [Sx] and [1]");
  });

  it("displayText picks the right style per action and leaves recaps and no-answer alone", () => {
    const base = { sources: ps, web: [], state: "done" as const };
    expect(displayText({ ...base, action: "suggest", text: "Say it [S1]" })).toBe("Say it\n\nSOURCES\n- week3.pdf, p. 4");
    expect(displayText({ ...base, action: "explain", text: "Idea [S1]" })).toBe("Idea [week3.pdf, p. 4]");
    expect(displayText({ ...base, action: "recap", text: "Recap [S1]" })).toBe("Recap [S1]");
    expect(displayText({ ...base, action: "suggest", text: "NO_ANSWER" })).toBe("NO_ANSWER");
  });

  it("spokenPart returns only the paragraph to read aloud", () => {
    const t = "YOU COULD SAY\nUse a queue.\nIt absorbs bursts.\n\nKEY TAKEAWAY\nDecouple.\n\nSOURCES\n- a";
    expect(spokenPart(t)).toBe("Use a queue.\nIt absorbs bursts.");
    expect(spokenPart("Answer: plain text")).toBe("plain text");
  });
});

describe("hard words", () => {
  it("are not part of the spoken copy", () => {
    const t = "YOU COULD SAY\nUse a queue.\n\nKEY TAKEAWAY\nDecouple.\n\nHARD WORDS\nqueue: a line where jobs wait\n\nSOURCES\n- a";
    expect(spokenPart(t)).toBe("Use a queue.");
  });
});
