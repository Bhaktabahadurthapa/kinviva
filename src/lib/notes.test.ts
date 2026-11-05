import { describe, expect, it } from "vitest";
import { titleFrom } from "./notes";

describe("titleFrom", () => {
  it("uses the first meaningful line without markdown marks", () => {
    expect(titleFrom("## Key points\n- one")).toBe("Key points");
    expect(titleFrom("\n\n> Quote here")).toBe("Quote here");
  });
  it("falls back and limits length", () => {
    expect(titleFrom("   ")).toBe("Note");
    expect(titleFrom("x".repeat(200)).length).toBe(80);
  });
});
