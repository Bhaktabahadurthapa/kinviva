import type { Segment } from "./types";

const norm = (s: string) => s.toLowerCase();

/** Segments whose text contains the query (case-insensitive). An empty query keeps all. */
export function filterSegments(segments: Segment[], query: string): Segment[] {
  const q = norm(query.trim());
  return q ? segments.filter((s) => norm(s.text).includes(q)) : segments;
}

export function countMatches(segments: Segment[], query: string): number {
  return query.trim() ? filterSegments(segments, query).length : 0;
}

/** Splits text into plain and matching parts so matches can be highlighted. */
export function splitHighlight(text: string, query: string): { text: string; hit: boolean }[] {
  const q = norm(query.trim());
  if (!q) return [{ text, hit: false }];
  const out: { text: string; hit: boolean }[] = [];
  const lower = norm(text);
  let i = 0;
  while (i < text.length) {
    const at = lower.indexOf(q, i);
    if (at < 0) {
      out.push({ text: text.slice(i), hit: false });
      break;
    }
    if (at > i) out.push({ text: text.slice(i, at), hit: false });
    out.push({ text: text.slice(at, at + q.length), hit: true });
    i = at + q.length;
  }
  return out;
}
