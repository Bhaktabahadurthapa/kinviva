import { describe, expect, it } from "vitest";
import type { ArchModel } from "./architecture";
import { archToSpec, describeOps, layout, levels, NODE_H, specToMermaid, toSkeleton, usableOps, type DiagramSpec } from "./board";

const spec: DiagramSpec = {
  title: "t", kind: "flowchart",
  nodes: [{ id: "a", label: "Client" }, { id: "b", label: "API" }, { id: "c", label: "DB" }, { id: "d", label: "Cache" }],
  edges: [{ from: "a", to: "b", label: "HTTPS" }, { from: "b", to: "c" }, { from: "b", to: "d", evidence: "inferred" }, { from: "a", to: "ghost" }],
};

describe("layout", () => {
  it("puts each step below its predecessor and siblings side by side", () => {
    const lv = levels(spec);
    expect([lv.get("a"), lv.get("b"), lv.get("c"), lv.get("d")]).toEqual([0, 1, 2, 2]);
    const p = Object.fromEntries(layout(spec).map((n) => [n.id, n]));
    expect(p.b.y).toBeGreaterThan(p.a.y + NODE_H);
    expect(p.c.y).toBe(p.d.y);
    expect(p.c.x).not.toBe(p.d.x);
  });
  it("terminates on cycles and handles an empty diagram", () => {
    const cyc: DiagramSpec = { title: "c", kind: "flowchart", nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: [{ from: "a", to: "b" }, { from: "b", to: "a" }] };
    expect(layout(cyc)).toHaveLength(2);
    expect(layout({ title: "e", kind: "flowchart", nodes: [], edges: [] })).toEqual([]);
  });
  it("lays timelines out left to right", () => {
    const t: DiagramSpec = { title: "t", kind: "timeline", nodes: [{ id: "a", label: "2020" }, { id: "b", label: "2021" }], edges: [{ from: "a", to: "b" }] };
    const p = layout(t);
    expect(p[1].x).toBeGreaterThan(p[0].x);
    expect(p[1].y).toBe(p[0].y);
  });
});

describe("skeleton and conversions", () => {
  it("creates editable objects with stable ids, tags, bindings and dashed inferred links", () => {
    const sk = toSkeleton(spec, { x: 100, y: 50 });
    const boxes = sk.filter((e) => e.type === "rectangle");
    const arrows = sk.filter((e) => e.type === "arrow");
    expect(boxes.map((b) => b.id)).toEqual(["ml-a", "ml-b", "ml-c", "ml-d"]);
    expect(arrows).toHaveLength(3); // the edge to a missing node is dropped
    expect((arrows[0].start as { id: string }).id).toBe("ml-a");
    expect(arrows.find((a) => a.strokeStyle === "dashed")).toBeTruthy();
    expect((boxes[0].customData as { ml: { ai: boolean } }).ml.ai).toBe(true);
    expect(boxes[0].x).toBeGreaterThanOrEqual(100 - 400);
  });
  it("turns an architecture model into a board diagram coloured by evidence", () => {
    const m = { title: "A", diagram: "flowchart", illustrative: false, confidence: "low", explanation: "", concerns: [], references: ["q"],
      components: [{ id: "n1", label: "LB", kind: "loadbalancer", evidence: "mentioned" }, { id: "n2", label: "DB", kind: "database", evidence: "inferred" }],
      relations: [{ from: "n1", to: "n2", label: "", evidence: "inferred" }] } as ArchModel;
    const s = archToSpec(m);
    expect(s.nodes[1].evidence).toBe("inferred");
    const sk = toSkeleton(s);
    expect(sk.find((e) => e.id === "ml-n2")?.strokeStyle).toBe("dashed");
    expect(sk.find((e) => e.id === "ml-n2")?.type).toBe("ellipse");
  });
  it("writes Mermaid with escaped labels", () => {
    const m = specToMermaid({ ...spec, nodes: [{ id: "a", label: "A\"]; click a" }, { id: "b", label: "B" }], edges: [{ from: "a", to: "b", label: "x" }] }, (s) => s.replace(/[^\w ]/g, " "));
    expect(m).toContain('n1["A    click a"]');
    expect(m).toContain('n1 -->|"x"| n2');
  });
});

describe("edit commands", () => {
  const nodes = [{ id: "e1", label: "API" }, { id: "e2", label: "Database" }];
  it("describes changes in words and reports impossible ones", () => {
    const r = describeOps([{ op: "add_node", label: "Redis", near: "e1" }, { op: "connect", from: "e1", to: "new1", label: "reads" }, { op: "remove", id: "zzz" }], nodes);
    expect(r.lines).toEqual(["Add “Redis” next to “API”", "Connect “API” to “Redis” (reads)"]);
    expect(r.problems).toHaveLength(1);
  });
  it("keeps only operations whose targets exist", () => {
    const ops = usableOps([{ op: "rename", id: "e2", label: "Postgres" }, { op: "remove", id: "nope" }, { op: "add_node", label: "Q", near: "" }, { op: "connect", from: "new1", to: "e1", label: "" }, { op: "connect", from: "ghost", to: "e1", label: "" }], nodes);
    expect(ops.map((o) => o.op)).toEqual(["rename", "add_node", "connect"]);
  });
});
