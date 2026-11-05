import { describe, expect, it } from "vitest";
import { splitCode } from "./ScreenAssist";

describe("splitCode", () => {
  it("separates prose from fenced code", () => {
    const t = "YOU COULD SAY\nUse a map.\n```python\ndef f():\n    return 1\n```\nHARD WORDS\nNone";
    const parts = splitCode(t);
    expect(parts.map((p) => p.code)).toEqual([false, true, false]);
    expect(parts[1].text).toBe("def f():\n    return 1");
  });
  it("keeps text without code as one prose part", () => {
    expect(splitCode("Just words")).toEqual([{ code: false, text: "Just words" }]);
  });
});
