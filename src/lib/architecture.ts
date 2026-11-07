/** Architecture diagrams: the checked model from the backend becomes Mermaid source
 *  through the deterministic code below. Model text never becomes Mermaid syntax. */

export type Evidence = "verified" | "mentioned" | "inferred";
export type DiagramKind = "flowchart" | "sequence";

export interface ArchComponent { id: string; label: string; kind: string; evidence: Evidence }
export interface ArchRelation { from: string; to: string; label: string; evidence: Evidence }
export interface ArchConcern { kind: "bottleneck" | "failure_point" | "security" | "unknown"; text: string }
export interface ArchModel {
  title: string;
  diagram: DiagramKind;
  illustrative: boolean;
  confidence: "low" | "medium" | "high";
  components: ArchComponent[];
  relations: ArchRelation[];
  explanation: string;
  concerns: ArchConcern[];
  references: string[];
}

export interface DiagramRecord {
  id: string;
  meeting_id: string | null;
  created_at: number;
  title: string;
  kind: string;
  source: string;
  model: string | null;
  origin: "generated" | "edited";
}

export const MAX_SOURCE_CHARS = 12_000;
export const MAX_SOURCE_LINES = 150;
export const MAX_EDGES = 80;

/** Label text: only letters, digits and harmless punctuation, so it can never act as syntax. */
export function esc(text: string, max = 40): string {
  return text
    .replace(/[^\p{L}\p{N} .,\-_/+']/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const NODE_SHAPE: Record<string, (t: string) => string> = {
  database: (t) => `[("${t}")]`,
  client: (t) => `(["${t}"])`,
  loadbalancer: (t) => `("${t}")`,
  gateway: (t) => `("${t}")`,
  ingress: (t) => `("${t}")`,
  queue: (t) => `[/"${t}"/]`,
  cache: (t) => `[("${t}")]`,
  storage: (t) => `[("${t}")]`,
};

const EVIDENCE_NOTE: Record<Evidence, string> = {
  verified: "Verified by your documents",
  mentioned: "Mentioned in the conversation",
  inferred: "Inferred by Kinviva (not said)",
};
export const evidenceNote = (e: Evidence) => EVIDENCE_NOTE[e];

const id = (s: string) => (/^n\d{1,3}$/.test(s) ? s : null);

/** Flowchart or sequence diagram source for a checked model. */
export function toMermaid(model: ArchModel): string {
  const comps = model.components.filter((c) => id(c.id));
  const known = new Set(comps.map((c) => c.id));
  const rels = model.relations.filter((r) => known.has(r.from) && known.has(r.to));
  if (model.diagram === "sequence") {
    const lines = ["sequenceDiagram"];
    for (const c of comps) lines.push(`  participant ${c.id} as ${esc(c.label)}${c.evidence === "inferred" ? " (inferred)" : ""}`);
    for (const r of rels) lines.push(`  ${r.from}${r.evidence === "inferred" ? "-->>" : "->>"}${r.to}: ${esc(r.label, 28) || "calls"}`);
    return lines.join("\n");
  }
  const lines = ["flowchart TD"];
  for (const c of comps) {
    const shape = (NODE_SHAPE[c.kind] ?? ((t: string) => `["${t}"]`))(esc(c.label));
    lines.push(`  ${c.id}${shape}:::${c.evidence}`);
  }
  for (const r of rels) {
    const label = esc(r.label, 28);
    const arrow = r.evidence === "inferred" ? "-.->" : "-->";
    lines.push(label ? `  ${r.from} ${arrow}|"${label}"| ${r.to}` : `  ${r.from} ${arrow} ${r.to}`);
  }
  lines.push(
    "  classDef verified fill:#e3f3ea,stroke:#2f7d4f,stroke-width:2px,color:#10321f",
    "  classDef mentioned fill:#e8eefc,stroke:#2556d9,stroke-width:1.5px,color:#102250",
    "  classDef inferred fill:#fff7e0,stroke:#a06a00,stroke-width:1.5px,stroke-dasharray:5 4,color:#4a3000",
  );
  return lines.join("\n");
}

export type SourceCheck = { ok: true; source: string; kind: DiagramKind | "other" } | { ok: false; error: string };

const HEADER = /^(flowchart|graph)\s+(TD|TB|BT|LR|RL)\s*$|^sequenceDiagram\s*$|^stateDiagram-v2\s*$|^erDiagram\s*$/;
const FORBIDDEN: [RegExp, string][] = [
  [/%%\s*\{/, "Mermaid directives (%%{ … }%%) are not allowed."],
  [/^\s*(click|href|callback|call|link|links)\b/im, "Click handlers and links are not allowed."],
  [/<[a-zA-Z/!?]/, "HTML is not allowed in diagrams."],
  [/(javascript|data|vbscript|file):/i, "Script and file links are not allowed."],
  [/https?:\/\//i, "External links are not allowed."],
  [/\burl\s*\(/i, "External resources are not allowed."],
  [/\bon[a-z]+\s*=/i, "Script content is not allowed."],
  [/^\s*(init|config)\b/im, "Configuration blocks are not allowed."],
];

/** Checks source before it reaches the renderer (typed in the editor, or loaded from history). */
export function checkSource(raw: string): SourceCheck {
  const source = raw.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim();
  if (!source) return { ok: false, error: "Write some diagram source first." };
  if (source.length > MAX_SOURCE_CHARS) return { ok: false, error: `The diagram is too large (over ${MAX_SOURCE_CHARS} characters).` };
  const lines = source.split("\n");
  if (lines.length > MAX_SOURCE_LINES) return { ok: false, error: `The diagram has too many lines (over ${MAX_SOURCE_LINES}).` };
  const first = lines.find((l) => l.trim() && !l.trim().startsWith("%%"))?.trim() ?? "";
  if (!HEADER.test(first)) return { ok: false, error: "Start with flowchart TD, sequenceDiagram, stateDiagram-v2 or erDiagram." };
  for (const [re, msg] of FORBIDDEN) if (re.test(source)) return { ok: false, error: msg };
  const edges = (source.match(/--+>|-\.+->|==+>|->>|-->>|---/g) ?? []).length;
  if (edges > MAX_EDGES) return { ok: false, error: `The diagram has too many connections (over ${MAX_EDGES}).` };
  return { ok: true, source, kind: first.startsWith("sequence") ? "sequence" : first.startsWith("flowchart") || first.startsWith("graph") ? "flowchart" : "other" };
}

const KEYWORDS = [
  "kubernetes", "k8s", "ingress", "load balancer", "loadbalancer", "api gateway", "microservice", "service mesh", "istio", "envoy",
  "postgres", "postgresql", "mysql", "mongodb", "redis", "kafka", "rabbitmq", "queue", "database", "cache", "s3", "lambda", "ec2", "eks", "aks", "gke",
  "aws", "azure", "gcp", "vpc", "subnet", "nginx", "docker", "container", "cluster", "terraform", "pipeline", "ci/cd", "jenkins", "github actions", "argo",
  "deployment", "architecture", "traffic", "latency", "endpoint", "replica", "autoscal", "observability", "prometheus", "grafana",
];

/** How architecture-like a piece of conversation is (distinct technical terms). */
export function architectureScore(text: string): number {
  const t = text.toLowerCase();
  return KEYWORDS.filter((k) => t.includes(k)).length;
}

export const AUTO_MIN_SCORE = 3;
export const AUTO_QUIET_MS = 6_000;
export const AUTO_MIN_GAP_MS = 45_000;

/** Whether the live view should refresh the diagram now: finalized speech only, enough of it, not too often. */
export function shouldAutoGenerate(a: {
  newText: string;
  lastGeneratedAt: number;
  lastActivityAt: number;
  now: number;
  generating: boolean;
}): boolean {
  if (a.generating || !a.newText.trim()) return false;
  if (architectureScore(a.newText) < AUTO_MIN_SCORE) return false;
  if (a.now - a.lastActivityAt < AUTO_QUIET_MS) return false;
  return a.now - a.lastGeneratedAt >= AUTO_MIN_GAP_MS;
}

/** A short title for saved diagrams and file names. */
export const fileStem = (title: string) => (esc(title, 40).replace(/\s+/g, "-").toLowerCase() || "architecture");
