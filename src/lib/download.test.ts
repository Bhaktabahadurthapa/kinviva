import { describe, expect, it } from "vitest";
import { safeName } from "./download";

describe("safeName", () => {
  it("keeps readable names and removes characters that break file names", () => {
    expect(safeName("OS week 3: scheduling/CPU?", "meeting")).toBe("OS week 3 schedulingCPU");
    expect(safeName("???", "meeting")).toBe("meeting");
    expect(safeName("x".repeat(200), "m").length).toBe(80);
  });
});
