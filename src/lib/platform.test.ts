import { describe, expect, it } from "vitest";
import { greeting, minutes, percent } from "./platform";

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
});
