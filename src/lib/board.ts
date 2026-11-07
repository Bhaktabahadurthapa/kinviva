/** Whiteboard logic that does not need the drawing library: diagram specs, layout, edit commands. */
import type { ArchModel } from "./architecture";

export type SpecKind = "flowchart" | "concept_map" | "decision_tree" | "timeline" | "sequence";
export interface SpecNode { id: string; label: string; detail?: string; evidence?: "verified" | "mentioned" | "inferred"; kind?: string }
export interface SpecEdge { from: string; to: string; label?: string; evidence?: "verified" | "mentioned" | "inferred" }
export interface DiagramSpec { title: string; kind: SpecKind; nodes: SpecNode[]; edges: SpecEdge[]; references?: string[] }

export const NODE_W = 190;
export const NODE_H = 72;
const GAP_X = 70;
const GAP_Y = 70;

export interface Placed extends SpecNode { x: number; y: number }

/** Levels by longest path from the roots (cycles are broken by visiting each node once). */
export function levels(spec: DiagramSpec): Map<string, number> {
  const ids = new Set(spec.nodes.map((n) => n.id));
  const out = new Map<string, string[]>();
  const indeg = new Map<string, number>(spec.nodes.map((n) => [n.id, 0]));
  for (const e of spec.edges) {
    if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to) continue;
    out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  }
  const level = new Map<string, number>();
  const roots = spec.nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const queue = roots.length ? roots : [spec.nodes[0]?.id].filter(Boolean);
  queue.forEach((r) => level.set(r, 0));
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    for (const next of out.get(id) ?? []) {
      const want = (level.get(id) ?? 0) + 1;
      if (!level.has(next)) {
        level.set(next, want);
        queue.push(next);
      } else if (want > (level.get(next) ?? 0) && want <= spec.nodes.length) {
        level.set(next, want); // longer path pushes it down (bounded, so cycles end)
      }
    }
  }
  for (const n of spec.nodes) if (!level.has(n.id)) level.set(n.id, 0);
  return level;
}

/** Positions for every node: top to bottom, or left to right for timelines. */
export function layout(spec: DiagramSpec, origin = { x: 0, y: 0 }): Placed[] {
  const lv = levels(spec);
  const rows = new Map<number, SpecNode[]>();
  for (const n of spec.nodes) rows.set(lv.get(n.id) ?? 0, [...(rows.get(lv.get(n.id) ?? 0) ?? []), n]);
  const horizontal = spec.kind === "timeline";
  const widest = Math.max(1, ...[...rows.values()].map((r) => r.length));
  const placed: Placed[] = [];
  for (const [level, row] of [...rows.entries()].sort((a, b) => a[0] - b[0])) {
    row.forEach((n, i) => {
      const offset = (i - (row.length - 1) / 2 + (widest - 1) / 2) * (horizontal ? NODE_H + GAP_Y : NODE_W + GAP_X);
      placed.push(horizontal
        ? { ...n, x: origin.x + level * (NODE_W + GAP_X), y: origin.y + offset }
        : { ...n, x: origin.x + offset, y: origin.y + level * (NODE_H + GAP_Y) });
    });
  }
  return placed;
}

const STYLE = {
  verified: { backgroundColor: "#e3f3ea", strokeColor: "#2f7d4f", strokeStyle: "solid" },
  mentioned: { backgroundColor: "#e8eefe", strokeColor: "#2563eb", strokeStyle: "solid" },
  inferred: { backgroundColor: "#fff7e0", strokeColor: "#a06a00", strokeStyle: "dashed" },
  plain: { backgroundColor: "#f3f4f8", strokeColor: "#4b5262", strokeStyle: "solid" },
} as const;

/** Tag kept on every object Kinviva creates, so later edits know what is theirs and what the user drew. */
export interface MlTag { ai: true; node?: string; evidence?: string; note?: string; ref?: string }

/** Excalidraw "skeleton" objects (converted by the library into real, editable elements). */
export function toSkeleton(spec: DiagramSpec, origin = { x: 0, y: 0 }, prefix = "ml"): Record<string, unknown>[] {
  const placed = layout(spec, origin);
  const byId = new Map(placed.map((p) => [p.id, p]));
  const sk: Record<string, unknown>[] = [];
  for (const p of placed) {
    const st = STYLE[p.evidence ?? "plain"];
    const shape = p.kind === "database" ? "ellipse" : spec.kind === "decision_tree" && spec.edges.filter((e) => e.from === p.id).length > 1 ? "diamond" : "rectangle";
    sk.push({
      type: shape, id: `${prefix}-${p.id}`, x: p.x, y: p.y, width: NODE_W, height: NODE_H, roundness: shape === "rectangle" ? { type: 3 } : undefined, ...st, strokeWidth: 2,
      label: { text: p.label, fontSize: 16 },
      customData: { ml: { ai: true, node: p.id, evidence: p.evidence, note: p.detail } satisfies MlTag },
    });
  }
  for (const e of spec.edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b || a === b) continue;
    // Explicit geometry (from the edge of one box to the edge of the next) plus bindings, so the
    // arrow is drawn correctly and still follows the boxes when the user moves them.
    const horizontal = spec.kind === "timeline";
    const x1 = horizontal ? a.x + NODE_W : a.x + NODE_W / 2;
    const y1 = horizontal ? a.y + NODE_H / 2 : a.y + NODE_H;
    const x2 = horizontal ? b.x : b.x + NODE_W / 2;
    const y2 = horizontal ? b.y + NODE_H / 2 : b.y;
    sk.push({
      type: "arrow", x: x1, y: y1, width: Math.abs(x2 - x1), height: Math.abs(y2 - y1), points: [[0, 0], [x2 - x1, y2 - y1]],
      start: { id: `${prefix}-${a.id}` }, end: { id: `${prefix}-${b.id}` },
      strokeColor: "#4b5262", strokeStyle: e.evidence === "inferred" ? "dashed" : "solid",
      ...(e.label ? { label: { text: e.label, fontSize: 14 } } : {}),
      customData: { ml: { ai: true, evidence: e.evidence } satisfies MlTag },
    });
  }
  return sk;
}

/** The checked architecture model as a board diagram (evidence decides the colours). */
export function archToSpec(m: ArchModel): DiagramSpec {
  return {
    title: m.title,
    kind: m.diagram === "sequence" ? "sequence" : "flowchart",
    nodes: m.components.map((c) => ({ id: c.id, label: c.label, evidence: c.evidence, kind: c.kind })),
    edges: m.relations.map((r) => ({ from: r.from, to: r.to, label: r.label, evidence: r.evidence })),
    references: m.references,
  };
}

/** Mermaid text for a board diagram (flowchart only; labels are escaped by the caller's `esc`). */
export function specToMermaid(spec: DiagramSpec, esc: (s: string) => string): string {
  const lines = [spec.kind === "timeline" ? "flowchart LR" : "flowchart TD"];
  spec.nodes.forEach((n, i) => lines.push(`  n${i + 1}["${esc(n.label)}"]`));
  const idx = new Map(spec.nodes.map((n, i) => [n.id, `n${i + 1}`]));
  for (const e of spec.edges) {
    const f = idx.get(e.from);
    const t = idx.get(e.to);
    if (f && t) lines.push(e.label ? `  ${f} -->|"${esc(e.label)}"| ${t}` : `  ${f} --> ${t}`);
  }
  return lines.join("\n");
}

// ---- edit commands ---------------------------------------------------------
export type BoardOp =
  | { op: "add_node"; label: string; near: string }
  | { op: "rename"; id: string; label: string }
  | { op: "remove"; id: string }
  | { op: "connect"; from: string; to: string; label: string }
  | { op: "highlight"; id: string; reason: string }
  | { op: "explain"; id: string; text: string };

export interface BoardNode { id: string; label: string }

/** What an operation list would do, in words, plus anything that cannot be applied. */
export function describeOps(ops: BoardOp[], nodes: BoardNode[]): { lines: string[]; problems: string[] } {
  const label = new Map(nodes.map((n) => [n.id, n.label]));
  const created = new Set<string>();
  let newCount = 0;
  const name = (id: string) => label.get(id) ?? (created.has(id) ? id : null);
  const lines: string[] = [];
  const problems: string[] = [];
  for (const o of ops) {
    if (o.op === "add_node") {
      newCount += 1;
      created.add(`new${newCount}`);
      label.set(`new${newCount}`, o.label);
      lines.push(`Add “${o.label}”${o.near && name(o.near) ? ` next to “${name(o.near)}”` : ""}`);
    } else if (o.op === "rename") name(o.id) ? lines.push(`Rename “${name(o.id)}” to “${o.label}”`) : problems.push(`Cannot rename: no object ${o.id}`);
    else if (o.op === "remove") name(o.id) ? lines.push(`Remove “${name(o.id)}” and its connections`) : problems.push(`Cannot remove: no object ${o.id}`);
    else if (o.op === "connect") name(o.from) && name(o.to) ? lines.push(`Connect “${name(o.from)}” to “${name(o.to)}”${o.label ? ` (${o.label})` : ""}`) : problems.push("Cannot connect: an end of the arrow does not exist");
    else if (o.op === "highlight") name(o.id) ? lines.push(`Highlight “${name(o.id)}” as a failure point${o.reason ? `: ${o.reason}` : ""}`) : problems.push(`Cannot highlight: no object ${o.id}`);
    else if (o.op === "explain") name(o.id) ? lines.push(`Explain “${name(o.id)}”: ${o.text}`) : problems.push(`Cannot explain: no object ${o.id}`);
  }
  return { lines, problems };
}

/** Only operations whose targets exist survive (a new node can be a target of later operations). */
export function usableOps(ops: BoardOp[], nodes: BoardNode[]): BoardOp[] {
  const ids = new Set(nodes.map((n) => n.id));
  let created = 0;
  const ok: BoardOp[] = [];
  for (const o of ops) {
    if (o.op === "add_node") {
      created += 1;
      ids.add(`new${created}`);
      ok.push(o);
    } else if (o.op === "connect" ? ids.has(o.from) && ids.has(o.to) : ids.has(o.id)) ok.push(o);
  }
  return ok;
}

export const nodesText = (nodes: BoardNode[], request: string) => `${nodes.map((n) => `${n.id}: ${n.label}`).join("\n")}\nREQUEST:\n${request}`;
