// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import mermaid from "mermaid";
import { architectureScore, checkSource, esc, shouldAutoGenerate, toMermaid, type ArchModel, MAX_EDGES } from "./architecture";

const model = (over: Partial<ArchModel> = {}): ArchModel => ({
  title: "Web app",
  diagram: "flowchart",
  illustrative: false,
  confidence: "medium",
  components: [
    { id: "n1", label: "AWS load balancer", kind: "loadbalancer", evidence: "mentioned" },
    { id: "n2", label: "Kubernetes services", kind: "service", evidence: "mentioned" },
    { id: "n3", label: "PostgreSQL", kind: "database", evidence: "verified" },
    { id: "n4", label: "Redis cache", kind: "cache", evidence: "inferred" },
  ],
  relations: [
    { from: "n1", to: "n2", label: "HTTPS", evidence: "mentioned" },
    { from: "n2", to: "n3", label: "SQL", evidence: "verified" },
    { from: "n2", to: "n4", label: "", evidence: "inferred" },
  ],
  explanation: "",
  concerns: [],
  references: [],
  ...over,
});

describe("toMermaid", () => {
  it("builds a flowchart that Mermaid accepts, marking inferred links as dashed", async () => {
    const src = toMermaid(model());
    expect(src.startsWith("flowchart TD")).toBe(true);
    expect(src).toContain("n4([\"Redis cache\"])".replace("([", "[(").replace("])", ")]"));
    expect(src).toContain("n2 -.-> n4");
    expect(src).toContain(":::inferred");
    await expect(mermaid.parse(src)).resolves.toBeTruthy();
  });
  it("builds a valid sequence diagram", async () => {
    const src = toMermaid(model({ diagram: "sequence" }));
    expect(src).toContain("participant n4 as Redis cache (inferred)");
    expect(src).toContain("n2-->>n4: calls");
    await expect(mermaid.parse(src)).resolves.toBeTruthy();
  });
  it("never lets model text become syntax", async () => {
    const evil = model({
      title: "x",
      components: [
        { id: "n1", label: "A\"]; click n1 href \"https://evil.example\" <script>", kind: "service", evidence: "mentioned" },
        { id: "n2", label: "B %%{init: {\"securityLevel\":\"loose\"}}%%", kind: "database", evidence: "mentioned" },
        { id: "bad id", label: "C", kind: "service", evidence: "mentioned" },
      ],
      relations: [{ from: "n1", to: "n2", label: "-->|x| n2; click n2 call alert()", evidence: "mentioned" }, { from: "n1", to: "ghost", label: "", evidence: "mentioned" }],
    });
    const src = toMermaid(evil);
    expect(checkSource(src).ok).toBe(true);
    expect(src).not.toMatch(/^\s*click\b|<|%%\{|https?:/im);
    expect(src.split("\n").filter((l) => /^\s*n\d+[\[({]/.test(l) && l.includes("click"))).toHaveLength(1); // harmless text inside a quoted label
    expect(src).not.toContain("ghost");
    expect(src).not.toContain("bad id");
    await expect(mermaid.parse(src)).resolves.toBeTruthy();
  });
  it("copes with an empty model and a very large one", async () => {
    expect(toMermaid(model({ components: [], relations: [] }))).toContain("flowchart TD");
    const comps = Array.from({ length: 24 }, (_, i) => ({ id: `n${i + 1}`, label: `Part ${i}`, kind: "service", evidence: "mentioned" as const }));
    const rels = Array.from({ length: 40 }, (_, i) => ({ from: `n${(i % 24) + 1}`, to: `n${((i + 1) % 24) + 1}`, label: "x", evidence: "mentioned" as const }));
    const src = toMermaid(model({ components: comps, relations: rels }));
    expect(checkSource(src).ok).toBe(true);
    await expect(mermaid.parse(src)).resolves.toBeTruthy();
  });
});

describe("checkSource", () => {
  it("accepts supported diagram types", () => {
    for (const s of ["flowchart LR\n a-->b", "graph TD\n a-->b", "sequenceDiagram\n a->>b: hi", "stateDiagram-v2\n [*] --> a", "erDiagram\n A ||--o{ B : has"]) {
      expect(checkSource(s).ok, s).toBe(true);
    }
  });
  it("rejects unsupported types, directives, links, html and huge input", () => {
    const bad: [string, RegExp][] = [
      ["pie title x\n \"a\": 1", /Start with/],
      ["flowchart TD\n %%{init: {\"securityLevel\":\"loose\"}}%%\n a-->b", /directives/],
      ["flowchart TD\n a-->b\n click a href \"https://x.y\"", /Click|External|links/],
      ["flowchart TD\n a[\"<img src=x onerror=alert(1)>\"]-->b", /HTML/],
      ["flowchart TD\n a[\"javascript:alert(1)\"]-->b", /Script/],
      ["", /Write some/],
      ["flowchart TD\n" + "a-->b\n".repeat(200), /too many lines|too large/],
      ["flowchart TD\n" + Array.from({ length: MAX_EDGES + 5 }, (_, i) => ` a${i}-->b${i}`).join("\n"), /too many connections/],
    ];
    for (const [s, re] of bad) {
      const r = checkSource(s);
      expect(r.ok, s.slice(0, 40)).toBe(false);
      if (!r.ok) expect(r.error).toMatch(re);
    }
  });
  it("lets Mermaid report invalid syntax", async () => {
    await expect(mermaid.parse("flowchart TD\n a -->")).rejects.toBeTruthy();
  });
});

describe("esc", () => {
  it("strips syntax characters", () => {
    expect(esc("a[b](c) <d> \"e\" `f` %%g {h} ;i")).toBe("a b c d e f g h i");
  });
});

describe("live detection and debouncing", () => {
  const talk = "We use an AWS load balancer, an ingress controller, Kubernetes services and PostgreSQL.";
  it("recognises architecture talk and ignores small talk", () => {
    expect(architectureScore(talk)).toBeGreaterThanOrEqual(4);
    expect(architectureScore("Thanks for joining, how was your weekend?")).toBe(0);
  });
  it("waits for a quiet moment, a minimum gap and an idle engine", () => {
    const base = { newText: talk, lastGeneratedAt: 0, lastActivityAt: 100_000, now: 100_000, generating: false };
    expect(shouldAutoGenerate(base)).toBe(false); // still talking
    expect(shouldAutoGenerate({ ...base, now: 107_000 })).toBe(true);
    expect(shouldAutoGenerate({ ...base, now: 107_000, lastGeneratedAt: 90_000 })).toBe(false); // too soon
    expect(shouldAutoGenerate({ ...base, now: 107_000, generating: true })).toBe(false);
    expect(shouldAutoGenerate({ ...base, now: 107_000, newText: "Hello there" })).toBe(false);
    expect(shouldAutoGenerate({ ...base, now: 107_000, newText: "" })).toBe(false);
  });
});
