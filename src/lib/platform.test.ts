import { describe, expect, it } from "vitest";
import { gaps, greeting, minutes, percent } from "./platform";

describe("platform helpers", () => {
  it("greets by hour", () => {
    expect([greeting(8), greeting(13), greeting(20)]).toEqual(["Good morning", "Good afternoon", "Good evening"]);
  });
  it("never invents progress", () => {
    expect(percent(0, 0)).toBeNull();
    expect(percent(2, 6)).toBe(33);
    expect(minutes(0, null)).toBeNull();
    expect(minutes(0, 90_000)).toBe(2);
    expect(minutes(0, 1000)).toBe(1);
  });
  it("reports knowledge gaps only from enough real answers", () => {
    expect(gaps([{ topic: "A", attempts: 1, total: 3, correct: 0 }, { topic: "B", attempts: 2, total: 10, correct: 5 }, { topic: "C", attempts: 2, total: 10, correct: 9 }]).map((g) => g.topic)).toEqual(["B"]);
  });
});
