import { describe, expect, it } from "vitest";
import { forModel, parseScript, scriptMarkdown } from "./script";

describe("pasted video scripts", () => {
  it("reads YouTube's transcript copy with the time on its own line", () => {
    const l = parseScript("0:00\nare vector databases still needed\n0:05\nI ask because there is discussion\n1:02:03\nlate line");
    expect(l.map((x) => [x.n, x.time, x.text])).toEqual([[1, "0:00", "are vector databases still needed"], [2, "0:05", "I ask because there is discussion"], [3, "1:02:03", "late line"]]);
  });
  it("reads lines that start with the time and skips accessibility labels", () => {
    const l = parseScript("0:12 first thing\n5 seconds\n0:20 - second thing");
    expect(l.map((x) => x.text)).toEqual(["first thing", "second thing"]);
  });
  it("cuts plain text into readable pieces and numbers them", () => {
    const text = Array.from({ length: 30 }, (_, i) => `This is sentence number ${i + 1}.`).join(" ");
    const l = parseScript(text);
    expect(l.length).toBeGreaterThan(2);
    expect(l.every((x) => x.time === null && x.text.length <= 260)).toBe(true);
    expect(forModel(l).startsWith("1| This is sentence number 1.")).toBe(true);
  });
  it("writes Markdown with chapters, key points and the important lines in bold", () => {
    const l = parseScript("0:00\nalpha\n0:05\nbeta");
    const md = scriptMarkdown("Talk", l, { summary: "About greek.", key_points: [{ line: 2, point: "Beta matters" }], important: [2], chapters: [{ line: 1, title: "Start" }] });
    expect(md).toContain("### Start");
    expect(md).toContain("- Beta matters");
    expect(md).toContain("[0:05] **beta**");
    expect(md).toContain("[0:00] alpha");
  });
});
