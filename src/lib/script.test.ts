import { describe, expect, it } from "vitest";
import { clampIndex, coverage, heardFlags, isSaid, parseScriptState, splitScript, wordsOf } from "./script";

describe("splitScript", () => {
  it("makes one line per paragraph and drops blanks", () => {
    expect(splitScript("Hello everyone.\n\n  Today we talk about   privacy.\r\n")).toEqual(["Hello everyone.", "Today we talk about privacy."]);
  });
  it("cuts a very long line at sentence ends without losing words", () => {
    const long = Array.from({ length: 12 }, (_, i) => `This is sentence number ${i + 1} of the long paragraph.`).join(" ");
    const lines = splitScript(long);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((l) => l.length <= 220)).toBe(true);
    expect(lines.join(" ")).toBe(long);
  });
  it("returns nothing for empty text", () => {
    expect(splitScript("  \n \n")).toEqual([]);
  });
});

describe("wordsOf", () => {
  it("lower-cases, drops punctuation, keeps apostrophes", () => {
    expect(wordsOf("Don't stop, it’s fine!")).toEqual(["don't", "stop", "it's", "fine"]);
  });
});

describe("matching what you said", () => {
  const line = "Our main goal is to make complex conversations easier to follow.";
  it("flags heard words in order", () => {
    const f = heardFlags(line, "our main goal is to make complex conversations");
    expect(f.slice(0, 8).every(Boolean)).toBe(true);
    expect(f.slice(8).some(Boolean)).toBe(false);
  });
  it("counts a line as said when most meaningful words were heard", () => {
    expect(isSaid(line, "so our main goal is to make complex conversations easier to follow")).toBe(true);
    expect(isSaid(line, "our main goal is to make complex")).toBe(false);
  });
  it("ignores small filler words for the decision", () => {
    expect(coverage("Please make it very clear to the team.", "please make very clear team")).toBe(1);
    // a very short line needs every word
    expect(coverage("Make it clear.", "make clear")).toBeLessThan(1);
  });
  it("does not count the same spoken word twice", () => {
    expect(coverage("privacy privacy privacy matters", "privacy matters")).toBeLessThan(1);
  });
  it("is not fooled by unrelated speech", () => {
    expect(isSaid(line, "can you share your screen please")).toBe(false);
  });
  it("never counts an empty line", () => {
    expect(isSaid("...", "anything")).toBe(false);
  });
});

describe("state helpers", () => {
  it("keeps the index inside the script", () => {
    expect(clampIndex(5, 3)).toBe(2);
    expect(clampIndex(-2, 3)).toBe(0);
    expect(clampIndex(1, 0)).toBe(0);
  });
  it("reads saved state safely", () => {
    expect(parseScriptState(null)).toEqual({ text: "", index: 0, follow: true });
    expect(parseScriptState("not json")).toEqual({ text: "", index: 0, follow: true });
    expect(parseScriptState('{"text":"a","index":2,"follow":false}')).toEqual({ text: "a", index: 2, follow: false });
  });
});
