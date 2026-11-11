/**
 * US-style resume layout. The resume stays plain text; this turns it into a small structure
 * (name, contact line, sections, roles, bullets) that is used for both the on-screen preview and
 * the Word file, so what you see is what is saved. Nothing here changes the words of the resume.
 */

export interface ResumeItem {
  kind: "role" | "bullet" | "skills" | "text";
  /** Role: the title or degree (shown bold). */
  left?: string;
  /** Role: company or school and place. */
  sub?: string;
  /** Role: dates, shown at the right. */
  dates?: string;
  /** Skills: the group name. */
  label?: string;
  text?: string;
}

export interface ResumeSection {
  heading: string;
  items: ResumeItem[];
}

export interface ResumeDoc {
  name: string;
  contacts: string[];
  sections: ResumeSection[];
}

export type TemplateId = "classic" | "modern" | "compact";

export interface TemplateInfo {
  id: TemplateId;
  label: string;
  blurb: string;
  font: string;
  /** Rough words per page, used only for the length hint. */
  perPage: number;
}

export const TEMPLATES: TemplateInfo[] = [
  { id: "classic", label: "Classic", blurb: "Times New Roman, centered name, ruled headings. The traditional US format; safe for every ATS.", font: "Times New Roman", perPage: 560 },
  { id: "modern", label: "Modern", blurb: "Calibri, left-aligned name, navy headings. Clean and easy to scan.", font: "Calibri", perPage: 600 },
  { id: "compact", label: "Compact (one page)", blurb: "Arial 10 pt with tighter spacing, to fit a lot on one page.", font: "Arial", perPage: 720 },
];

const HEADINGS = new Map<string, string>([
  ["summary", "Summary"], ["professional summary", "Summary"], ["profile", "Summary"], ["objective", "Summary"],
  ["skills", "Skills"], ["technical skills", "Skills"], ["core skills", "Skills"], ["core competencies", "Skills"],
  ["experience", "Experience"], ["work experience", "Experience"], ["professional experience", "Experience"], ["employment", "Experience"], ["employment history", "Experience"],
  ["projects", "Projects"], ["selected projects", "Projects"],
  ["education", "Education"], ["certifications", "Certifications"], ["certificates", "Certifications"], ["licenses", "Certifications"],
  ["publications", "Publications"], ["awards", "Awards"], ["languages", "Languages"], ["volunteer", "Volunteer"], ["volunteering", "Volunteer"],
]);
const ROLE_SECTIONS = new Set(["Experience", "Projects", "Education", "Volunteer"]);

const MONTH = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?";
const POINT = `(?:${MONTH}\\s+)?(?:19|20)\\d{2}`;
const RANGE = new RegExp(`(${POINT})\\s*(?:-|–|—|to)\\s*(${POINT}|Present|Current|Now)`, "i");
const SINGLE = new RegExp(`[,|]?\\s*(${POINT})\\s*$`, "i");

export function headingOf(line: string): string | null {
  const t = line.trim().replace(/:$/, "");
  if (!t || t.length > 40) return null;
  return HEADINGS.get(t.toLowerCase()) ?? null;
}

const tidyDate = (d: string) => d.replace(/\s+/g, " ").trim().replace(/^now$/i, "Present").replace(/^current$/i, "Present");

/** Splits a role line into title, place and dates. "SRE, Acme, 2020-2024" and "SRE | Acme | Austin, TX | Jan 2020 - Present" both work. */
export function parseRole(line: string): ResumeItem | null {
  let rest = line.trim();
  let dates = "";
  const r = RANGE.exec(rest);
  if (r) {
    dates = `${tidyDate(r[1])} – ${tidyDate(r[2])}`;
    rest = (rest.slice(0, r.index) + " " + rest.slice(r.index + r[0].length)).trim();
  } else {
    const s = SINGLE.exec(rest);
    if (s && rest.length > s[0].length) {
      dates = tidyDate(s[1]);
      rest = rest.slice(0, s.index).trim();
    }
  }
  rest = rest.replace(/[|,–—-]+\s*$/, "").replace(/^[|,–—-]+\s*/, "").trim();
  const hasPipe = rest.includes("|");
  if (!dates && !hasPipe) return null;
  const parts = (hasPipe ? rest.split("|") : rest.split(",")).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  return { kind: "role", left: parts[0], sub: parts.slice(1).join(", "), dates };
}

/** Turns plain resume text into a layout structure. Lines it does not recognize are kept as text, never dropped. */
export function parseResume(text: string): ResumeDoc {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/\s+$/, ""));
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  const name = (lines[i++] ?? "").trim();
  const contacts: string[] = [];
  const sections: ResumeSection[] = [];
  let cur: ResumeSection | null = null;
  for (; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (!t) continue;
    const h = headingOf(t);
    if (h) {
      cur = { heading: h, items: [] };
      sections.push(cur);
      continue;
    }
    if (!cur) {
      contacts.push(...t.split(/\s*[|•·]\s*/).map((c) => c.trim()).filter(Boolean));
      continue;
    }
    const bullet = /^[-*•·–]\s+(.*)$/.exec(t);
    if (bullet) {
      cur.items.push({ kind: "bullet", text: bullet[1] });
    } else if (cur.heading === "Skills") {
      const g = /^([^:]{2,40}):\s*(.+)$/.exec(t);
      cur.items.push(g ? { kind: "skills", label: g[1].trim(), text: g[2].trim() } : { kind: "skills", text: t });
    } else if (ROLE_SECTIONS.has(cur.heading)) {
      cur.items.push(parseRole(t) ?? { kind: "text", text: t });
    } else {
      cur.items.push({ kind: "text", text: t });
    }
  }
  return { name, contacts, sections };
}

/** Words in the resume body, for the length hint. */
export function wordCount(text: string): number {
  return (text.match(/\S+/g) ?? []).length;
}

/** "About 1 page" from the word count and the template's density. A hint, not a measurement. */
export function pageHint(text: string, t: TemplateInfo): string {
  const pages = wordCount(text) / t.perPage;
  return pages <= 1 ? "about 1 page" : pages <= 2 ? "about 2 pages" : "more than 2 pages: cut the oldest or least relevant items";
}

/** Things US recruiters and ATS software expect, checked on the parsed layout. */
export function usChecks(doc: ResumeDoc, text: string): { ok: boolean; label: string }[] {
  const has = (h: string) => doc.sections.some((s) => s.heading === h && s.items.length > 0);
  const contact = doc.contacts.join(" ");
  const exp = doc.sections.find((s) => s.heading === "Experience");
  const roles = exp?.items.filter((x) => x.kind === "role") ?? [];
  const bullets = exp?.items.filter((x) => x.kind === "bullet") ?? [];
  return [
    { ok: !!doc.name && doc.name.length < 50 && !/@|\d{3}/.test(doc.name), label: "Your name is on the first line" },
    { ok: /[\w.+-]+@[\w-]+\.[\w.]+/.test(contact) && /\d[\d\s().-]{6,}\d/.test(contact), label: "Contact line has an email and a phone number" },
    { ok: !/\b(date of birth|dob|marital|nationality|photo|gender)\b/i.test(text), label: "No photo, birth date or marital status (not used in US resumes)" },
    { ok: has("Experience"), label: "Has an Experience section" },
    { ok: has("Education"), label: "Has an Education section" },
    { ok: has("Skills"), label: "Has a Skills section" },
    { ok: roles.length > 0 && roles.every((r) => r.dates), label: "Every role has dates (month and year are best)" },
    { ok: roles.length === 0 || bullets.length >= roles.length * 2, label: "At least 2 bullet points under each role" },
  ];
}

export interface DiffLine {
  kind: "same" | "add" | "del";
  text: string;
}

/** Line-by-line difference between two texts (longest common lines, spacing ignored), so you can see exactly what changed. */
export function diffLines(before: string, after: string): DiffLine[] {
  const norm = (t: string) => t.replace(/\s+/g, " ").trim();
  const a = before.split("\n").filter((l) => l.trim());
  const b = after.split("\n").filter((l) => l.trim());
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = norm(a[i]) === norm(b[j]) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (norm(a[i]) === norm(b[j])) out.push({ kind: "same", text: b[j++] }), i++;
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ kind: "del", text: a[i++] });
    else out.push({ kind: "add", text: b[j++] });
  }
  while (i < n) out.push({ kind: "del", text: a[i++] });
  while (j < m) out.push({ kind: "add", text: b[j++] });
  return out;
}
