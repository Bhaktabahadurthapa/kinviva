import { describe, expect, it } from "vitest";
import { emptyIncident, mergeExtracted, parseIncident, planToText, rootCauseAllowed, type TroubleshootPlan } from "./incident";

describe("incident logic", () => {
  it("does not allow a root cause without a supported hypothesis and evidence", () => {
    const d = { ...emptyIncident(), hypotheses: [{ text: "OOM", state: "hypothesis" as const }] };
    expect(rootCauseAllowed(d)).toBe(false);
    expect(rootCauseAllowed({ ...d, hypotheses: [{ text: "OOM", state: "supported" }] })).toBe(false); // no evidence yet
    expect(rootCauseAllowed({ ...d, hypotheses: [{ text: "OOM", state: "supported" }], evidence: ["kubectl describe shows OOMKilled"] })).toBe(true);
  });
  it("merges items from the conversation without duplicates or promoting hypotheses", () => {
    const d = { ...emptyIncident(), symptoms: ["Pods restart"], hypotheses: [{ text: "Bad deploy", state: "supported" as const }] };
    const m = mergeExtracted(d, { symptoms: ["pods restart", "High latency"], hypotheses: ["bad deploy", "Memory limit"], evidence: ["  "] });
    expect(m.symptoms).toEqual(["Pods restart", "High latency"]);
    expect(m.hypotheses).toEqual([{ text: "Bad deploy", state: "supported" }, { text: "Memory limit", state: "hypothesis" }]);
    expect(m.evidence).toEqual([]);
  });
  it("reads stored data defensively", () => {
    expect(parseIncident("not json")).toEqual(emptyIncident());
    expect(parseIncident(JSON.stringify({ status: "weird", symptoms: ["a", 3], hypotheses: [{ text: "x", state: "bad" }, 5] })).hypotheses).toEqual([{ text: "x", state: "hypothesis" }]);
  });
  it("writes a plan as plain text with hypotheses labelled", () => {
    const p: TroubleshootPlan = { summary: "Pods restart", possible_causes: [{ cause: "Memory limit", likelihood: "high", why: "OOMKilled", status: "hypothesis" }], evidence_to_collect: ["Pod events"], commands: [{ command: "kubectl describe pod web-1", purpose: "see events", expect: "OOMKilled", risk: "low", read_only: true }], removed_unsafe_commands: 0, verification: [], unknowns: [] };
    const t = planToText(p);
    expect(t).toContain("hypotheses, not confirmed");
    expect(t).toContain("kubectl describe pod web-1");
  });
});
