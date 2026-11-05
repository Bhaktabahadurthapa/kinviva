import { stripMarks } from "./highlight";
import type { AiSlot, Passage } from "./types";

/** "notes.pdf, p. 4" for PDFs, "notes.md, part 2" for text files. */
export function citationText(p: Passage): string {
  return p.page != null ? `${p.document}, p. ${p.page}` : `${p.document}, part ${p.chunk + 1}`;
}

/** Labels for the sources given to the model: your files first, then web results (same order as the backend). */
export function sourceLabels(slot: Pick<AiSlot, "sources" | "web">): string[] {
  const web = (slot.web ?? []).map((w) => {
    let host = "";
    try {
      host = new URL(w.url).host;
    } catch {
      /* keep the title only */
    }
    return host ? `${w.title} (${host})` : w.title;
  });
  return [...(slot.sources ?? []).map(citationText), ...web];
}

export type CiteStyle = { kind: "inline" } | { kind: "section"; complete: boolean };

export interface Normalized {
  text: string;
  /** 0-based indexes of the sources the answer really cited. */
  cited: number[];
}

const GROUP = /(\s?)\[(S\d+(?:\s*[,;]\s*S\d+|\s+S\d+)*)\]/g;
const ids = (inner: string) => inner.split(/[\s,;]+/).filter(Boolean).map((t) => Number(t.slice(1)));
const isSourcesHeader = (l: string) => /^\**\s*sources\s*:?\s*\**$/i.test(l.trim());

/** Removes every source marker and returns their numbers (1-based). */
function takeMarkers(text: string): { text: string; found: number[] } {
  const found: number[] = [];
  const out = text.replace(GROUP, (_m, lead: string, inner: string, offset: number, whole: string) => {
    found.push(...ids(inner));
    const after = whole[offset + _m.length];
    // Drop the space before the marker so "word [S1]." becomes "word."
    return lead && after !== undefined && !/[\s.,;:!?)]/.test(after) ? lead : "";
  });
  return { text: out, found };
}

/**
 * Makes an answer safe to show. Only citations that match retrieved sources
 * (`labels`, in the order they were given to the model) are displayed; any other
 * marker is dropped, so an invented citation or page can never appear.
 * Mirrors `session::normalize_answer` in the backend.
 */
export function normalizeAnswer(text: string, labels: string[], style: CiteStyle): Normalized {
  const valid = (n: number) => n >= 1 && n <= labels.length;
  if (style.kind === "inline") {
    const cited: number[] = [];
    const out = text.replace(GROUP, (_m, lead: string, inner: string, offset: number, whole: string) => {
      const good = ids(inner).filter(valid);
      cited.push(...good.map((n) => n - 1));
      if (good.length) return `${lead}[${good.map((n) => labels[n - 1]).join("; ")}]`;
      const after = whole[offset + _m.length];
      return lead && after !== undefined && !/[\s.,;:!?)]/.test(after) ? lead : "";
    });
    return { text: out, cited: [...new Set(cited)] };
  }
  const lines = text.split("\n");
  const split = lines.findIndex(isSourcesHeader);
  const bodyLines = split >= 0 ? lines.slice(0, split) : lines;
  const sourceLines = split >= 0 ? lines.slice(split + 1) : [];
  const body = takeMarkers(bodyLines.join("\n"));
  const all = [...body.found];
  const general: string[] = [];
  for (const l of sourceLines) {
    const t = takeMarkers(l);
    all.push(...t.found);
    const clean = t.text.trim().replace(/^[-*•]\s*/, "").trim();
    if (clean.toLowerCase().startsWith("general knowledge")) general.push(clean.slice(0, 200));
  }
  const cited: number[] = [];
  for (const n of all.filter(valid)) if (!cited.includes(n - 1)) cited.push(n - 1);
  const trimmed = body.text.replace(/\s+$/, "");
  if (split < 0 && !style.complete) return { text: trimmed, cited };
  let out = `${trimmed}\n\nSOURCES\n`;
  if (!cited.length && !general.length) {
    out += labels.length ? "General knowledge. The provided documents were not used." : "General knowledge. No document was provided.";
  } else {
    out += [...cited.map((k) => `- ${labels[k]}`), ...general.map((g) => `- ${g}`)].join("\n");
  }
  return { text: out, cited };
}

/** What to show for a slot's text: answers get a SOURCES section, explanations get inline citations. */
export function displayText(slot: Pick<AiSlot, "text" | "sources" | "web" | "action" | "state">): string {
  if (!slot.text || /^\s*NO_ANSWER\b/i.test(slot.text)) return slot.text;
  if (slot.action === "recap") return slot.text;
  const labels = sourceLabels(slot);
  const answer = slot.action === "suggest" || slot.action === "ask";
  return normalizeAnswer(slot.text, labels, answer ? { kind: "section", complete: slot.state === "done" } : { kind: "inline" }).text;
}

/** The part to read aloud (or copy): the YOU COULD SAY paragraph, else the whole text. */
export function spokenPart(text: string): string {
  return stripMarks(spokenRaw(text));
}
function spokenRaw(text: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^\**\s*you could say\s*:?\s*\**$/i.test(l.trim()));
  if (start < 0) return text.replace(/^\s*(Answer|Details):\s*/gim, "").trim();
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^\**\s*(key takeaway|hard words|sources|clarification|what i see|explanation)\s*:?\s*\**$/i.test(l.trim()));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
}
