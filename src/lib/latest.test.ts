import { describe, expect, it } from "vitest";
import { latestGuard } from "./latest";

describe("latestGuard", () => {
  it("lets only the newest request through, however the answers arrive", () => {
    const g = latestGuard();
    const first = g.next();
    const second = g.next();
    expect(g.isCurrent(first)).toBe(false);
    expect(g.isCurrent(second)).toBe(true);
  });
  it("invalidates a request that is still on its way (for example after opening a saved diagram)", () => {
    const g = latestGuard();
    const id = g.next();
    g.invalidate();
    expect(g.isCurrent(id)).toBe(false);
  });
});
