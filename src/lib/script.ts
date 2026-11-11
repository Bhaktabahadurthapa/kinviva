/**
 * "My script": text you wrote yourself, shown line by line in the overlay.
 * Nothing here calls an AI. The lines are shown exactly as you wrote them.
 * It can move to the next line when it hears you say the current one.
 */

export interface ScriptState {
  text: string;
  /** Index of the current line. */
  index: number;
  /** Move on by itself when your voice covers the current line. */
  follow: boolean;
}

export const SCRIPT_KEY = "ml.script1";
export const EMPTY_SCRIPT: ScriptState = { text: "", index: 0, follow: true };

const MAX_LINE = 220;

/** One line per paragraph or line break. A very long line is cut at sentence ends so it stays readable. */
export function splitScript(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) continue;
    if (line.length <= MAX_LINE) {
      out.push(line);
      continue;
    }
    // Sentences, then pack them into chunks of at most MAX_LINE characters.
    const sentences = line.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [line];
    let cur = "";
    for (const s of sentences.map((x) => x.trim()).filter(Boolean)) {
      if (cur && (cur + " " + s).length > MAX_LINE) {
        out.push(cur);
        cur = s;
      } else {
        cur = cur ? cur + " " + s : s;
      }
    }
    if (cur) out.push(cur);
  }
  return out;
}

/** Lower-case words without punctuation. Apostrophes inside a word are kept ("don't"). */
export function wordsOf(s: string): string[] {
  return (s.toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? []).map((w) => w.replace(/’/g, "'"));
}

/** Short filler words carry no signal for matching what was said. */
const SMALL = new Set(["a", "an", "the", "of", "to", "in", "on", "at", "and", "or", "is", "it", "as", "i", "so", "we", "be", "by", "my"]);

/**
 * For each word of the line: was it heard? Words are matched in order (each spoken word is used once),
 * so repeating a common word elsewhere in the sentence does not count as saying this line.
 */
export function heardFlags(line: string, spoken: string): boolean[] {
  const lw = wordsOf(line);
  const sw = wordsOf(spoken);
  const flags = lw.map(() => false);
  let from = 0;
  for (let i = 0; i < lw.length; i++) {
    for (let j = from; j < sw.length; j++) {
      if (sw[j] === lw[i]) {
        flags[i] = true;
        from = j + 1;
        break;
      }
    }
  }
  return flags;
}

/** Share of the meaningful words of the line that were heard, from 0 to 1. A line with no words counts as 0. */
export function coverage(line: string, spoken: string): number {
  const lw = wordsOf(line);
  if (!lw.length) return 0;
  const flags = heardFlags(line, spoken);
  const strong = lw.map((w, i) => ({ w, i })).filter(({ w }) => !SMALL.has(w) || lw.length <= 3);
  const pool = strong.length ? strong : lw.map((w, i) => ({ w, i }));
  const hit = pool.filter(({ i }) => flags[i]).length;
  return hit / pool.length;
}

/** The line counts as said when most of its words were heard in order. */
export const SAID_AT = 0.75;
export const isSaid = (line: string, spoken: string) => wordsOf(line).length > 0 && coverage(line, spoken) >= SAID_AT;

export function clampIndex(index: number, lines: number): number {
  if (lines <= 0) return 0;
  return Math.min(Math.max(0, Math.floor(index) || 0), lines - 1);
}

export function parseScriptState(raw: string | null): ScriptState {
  if (!raw) return { ...EMPTY_SCRIPT };
  try {
    const v = JSON.parse(raw) as Partial<ScriptState>;
    return {
      text: typeof v.text === "string" ? v.text : "",
      index: typeof v.index === "number" ? Math.max(0, Math.floor(v.index)) : 0,
      follow: typeof v.follow === "boolean" ? v.follow : true,
    };
  } catch {
    return { ...EMPTY_SCRIPT };
  }
}
