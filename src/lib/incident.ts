/** Incident tracking: manual lists plus items extracted from the conversation. Pure logic, no I/O. */
export type Hypothesis = { text: string; state: "hypothesis" | "supported" | "ruled_out" };
export interface IncidentData {
  status: "open" | "monitoring" | "resolved";
  symptoms: string[];
  hypotheses: Hypothesis[];
  evidence: string[];
  actions: string[];
  decisions: string[];
  open_questions: string[];
  follow_ups: string[];
  root_cause: string;
}
export type ListKey = "symptoms" | "evidence" | "actions" | "decisions" | "open_questions" | "follow_ups";

export const emptyIncident = (): IncidentData => ({ status: "open", symptoms: [], hypotheses: [], evidence: [], actions: [], decisions: [], open_questions: [], follow_ups: [], root_cause: "" });

export function parseIncident(body: string): IncidentData {
  try {
    const v = JSON.parse(body) as Partial<IncidentData>;
    const e = emptyIncident();
    const list = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
    return {
      status: v.status === "monitoring" || v.status === "resolved" ? v.status : "open",
      symptoms: list(v.symptoms), evidence: list(v.evidence), actions: list(v.actions), decisions: list(v.decisions), open_questions: list(v.open_questions), follow_ups: list(v.follow_ups),
      hypotheses: Array.isArray(v.hypotheses) ? v.hypotheses.filter((h) => h && typeof h.text === "string").map((h) => ({ text: h.text, state: h.state === "supported" || h.state === "ruled_out" ? h.state : "hypothesis" })) : [],
      root_cause: typeof v.root_cause === "string" ? v.root_cause : e.root_cause,
    };
  } catch {
    return emptyIncident();
  }
}

/** A root cause may only be written once a hypothesis is marked supported and some evidence is recorded. */
export const rootCauseAllowed = (d: IncidentData) => d.hypotheses.some((h) => h.state === "supported") && d.evidence.length > 0;

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const addUnique = (list: string[], items: string[]) => [...list, ...items.filter((i) => i.trim() && !list.some((x) => same(x, i)))];

/** Adds items found in the conversation without duplicating or touching what the user already wrote. Extracted hypotheses stay hypotheses. */
export function mergeExtracted(d: IncidentData, x: Partial<Record<ListKey | "hypotheses", string[]>>): IncidentData {
  const hyp = [...d.hypotheses];
  for (const t of x.hypotheses ?? []) if (t.trim() && !hyp.some((h) => same(h.text, t))) hyp.push({ text: t, state: "hypothesis" });
  return {
    ...d,
    symptoms: addUnique(d.symptoms, x.symptoms ?? []), evidence: addUnique(d.evidence, x.evidence ?? []), actions: addUnique(d.actions, x.actions ?? []),
    decisions: addUnique(d.decisions, x.decisions ?? []), open_questions: addUnique(d.open_questions, x.open_questions ?? []), follow_ups: addUnique(d.follow_ups, x.follow_ups ?? []),
    hypotheses: hyp,
  };
}

export interface TroubleshootPlan {
  summary: string;
  possible_causes: { cause: string; likelihood: "low" | "medium" | "high"; why: string; status: string }[];
  evidence_to_collect: string[];
  commands: { command: string; purpose: string; expect: string; risk: "low" | "medium" | "high"; read_only: boolean }[];
  removed_unsafe_commands: number;
  verification: string[];
  unknowns: string[];
}

export function planToText(p: TroubleshootPlan): string {
  const L = (h: string, items: string[]) => (items.length ? `\n${h}\n${items.map((i) => `- ${i}`).join("\n")}\n` : "");
  return [
    p.summary,
    L("Possible causes (hypotheses, not confirmed)", p.possible_causes.map((c) => `${c.cause} (${c.likelihood}): ${c.why}`)),
    L("Evidence to collect", p.evidence_to_collect),
    L("Read-only commands", p.commands.map((c) => `${c.command}  # ${c.purpose}. Expect: ${c.expect}. Risk: ${c.risk}`)),
    L("Verification", p.verification),
    L("Unknowns", p.unknowns),
  ].join("\n").trim();
}
