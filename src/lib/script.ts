/** A pasted video script, cut into numbered lines. Nothing is rewritten: the reader sees the words as they were. */
export interface ScriptLine { n: number; time: string | null; text: string }

const TIME_ONLY = /^\(?(\d{1,2}:)?\d{1,2}:\d{2}\)?$/;
const TIME_FIRST = /^\(?((?:\d{1,2}:)?\d{1,2}:\d{2})\)?[\s\-–—.]+(.+)$/;

/** Reads a pasted script: YouTube's "Show transcript" copy (time on its own line, or in front of the text), or plain text. */
export function parseScript(raw: string): ScriptLine[] {
  const rows = raw.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  const out: { time: string | null; text: string }[] = [];
  let pending: string | null = null;
  const timed = rows.some((r) => TIME_ONLY.test(r) || TIME_FIRST.test(r));
  if (timed) {
    for (const r of rows) {
      if (TIME_ONLY.test(r)) {
        pending = r.replace(/[()]/g, "");
        continue;
      }
      const m = r.match(TIME_FIRST);
      if (m) {
        out.push({ time: m[1], text: m[2].trim() });
        pending = null;
        continue;
      }
      if (/^\d+\s+(seconds?|minutes?)(,\s*\d+\s+seconds?)?$/i.test(r)) continue; // accessibility labels such as "5 seconds"
      out.push({ time: pending, text: r });
      pending = null;
    }
  } else {
    // Plain text: break it into sentences of a readable size.
    for (const para of rows) {
      let cur = "";
      for (const sentence of para.split(/(?<=[.!?])\s+/)) {
        if (cur && (cur + " " + sentence).length > 220) {
          out.push({ time: null, text: cur });
          cur = sentence;
        } else cur = cur ? `${cur} ${sentence}` : sentence;
      }
      if (cur) out.push({ time: null, text: cur });
    }
  }
  return out.filter((l) => l.text.length > 0).slice(0, 4000).map((l, i) => ({ n: i + 1, time: l.time, text: l.text }));
}

/** The script as the answer engine reads it: "12| text". */
export const forModel = (lines: ScriptLine[]) => lines.map((l) => `${l.n}| ${l.text}`).join("\n");

export interface ScriptInsights {
  summary: string;
  key_points: { line: number; point: string }[];
  important: number[];
  chapters: { line: number; title: string }[];
}
export function parseInsights(json: string): ScriptInsights {
  const v = JSON.parse(json) as ScriptInsights;
  return { summary: v.summary ?? "", key_points: v.key_points ?? [], important: v.important ?? [], chapters: v.chapters ?? [] };
}

/** Plain Markdown of the whole script, with the important lines in bold and chapter headings. */
export function scriptMarkdown(title: string, lines: ScriptLine[], ins: ScriptInsights | null): string {
  const chap = new Map((ins?.chapters ?? []).map((c) => [c.line, c.title]));
  const imp = new Set(ins?.important ?? []);
  const out: string[] = [`# ${title}`, ""];
  if (ins?.summary) out.push(ins.summary, "");
  if (ins?.key_points.length) out.push("## Key points", ...ins.key_points.map((k) => `- ${k.point}`), "");
  out.push("## Script", "");
  for (const l of lines) {
    if (chap.has(l.n)) out.push("", `### ${chap.get(l.n)}`, "");
    out.push(`${l.time ? `[${l.time}] ` : ""}${imp.has(l.n) ? `**${l.text}**` : l.text}`);
  }
  return out.join("\n");
}
