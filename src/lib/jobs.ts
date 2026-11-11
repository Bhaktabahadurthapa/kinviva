/**
 * Jobs: a match estimate between your resume and a job, a check that a tailored resume adds nothing
 * new, and the small saved state (resume, tracker). No AI is used here: the numbers come from
 * counting skills and words, so the same input always gives the same result.
 */

export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  description: string;
  source: string;
  posted_ms: number | null;
  remote: boolean;
}

export interface JobsReport {
  jobs: Job[];
  errors: string[];
}

export const CATEGORIES: { id: string; label: string }[] = [
  { id: "devops", label: "DevOps, Cloud, SRE" },
  { id: "software", label: "Software engineering" },
  { id: "data", label: "Data and AI" },
  { id: "security", label: "Security" },
  { id: "it", label: "IT and systems" },
  { id: "product", label: "Product" },
  { id: "design", label: "Design" },
  { id: "support", label: "Support" },
];

/** Canonical skill, then the other ways people write it. */
const SKILLS: [string, string[]][] = [
  ["aws", ["amazon web services"]], ["azure", []], ["gcp", ["google cloud"]], ["kubernetes", ["k8s", "eks", "aks", "gke"]], ["docker", ["containers", "containerization"]],
  ["terraform", ["opentofu"]], ["ansible", []], ["helm", []], ["jenkins", []], ["github actions", []], ["gitlab ci", ["gitlab"]], ["circleci", []], ["argo cd", ["argocd"]],
  ["ci/cd", ["ci cd", "cicd", "continuous integration", "continuous delivery", "continuous deployment"]], ["prometheus", []], ["grafana", []], ["datadog", []], ["splunk", []],
  ["elk", ["elasticsearch", "opensearch", "kibana", "logstash"]], ["opentelemetry", ["otel"]], ["cloudformation", []], ["pulumi", []], ["linux", ["unix", "ubuntu", "rhel"]],
  ["bash", ["shell scripting", "shell"]], ["python", []], ["go", ["golang"]], ["java", []], ["javascript", ["js"]], ["typescript", ["ts"]], ["rust", []], ["c#", ["dotnet", ".net"]],
  ["c++", []], ["ruby", []], ["php", []], ["sql", ["postgresql", "postgres", "mysql"]], ["nosql", ["mongodb", "dynamodb", "cassandra"]], ["redis", []], ["kafka", []],
  ["react", ["reactjs"]], ["angular", []], ["vue", ["vuejs"]], ["node.js", ["nodejs", "node"]], ["rest", ["rest api", "restful"]], ["graphql", []], ["microservices", []],
  ["serverless", ["lambda"]], ["networking", ["tcp/ip", "dns", "load balancing", "vpc"]], ["security", ["iam", "devsecops", "owasp"]], ["monitoring", ["observability"]],
  ["incident response", ["on-call", "on call", "incident management", "postmortem"]], ["sre", ["site reliability"]], ["git", ["github", "version control"]], ["agile", ["scrum", "kanban"]],
  ["machine learning", ["ml", "deep learning"]], ["data engineering", ["etl", "data pipelines", "airflow", "spark", "dbt"]], ["tableau", ["power bi", "looker"]], ["excel", []],
  ["figma", []], ["ux", ["user experience", "ui design"]], ["jira", []], ["salesforce", []], ["zendesk", []], ["customer support", ["customer service"]],
  ["project management", ["pmp", "stakeholder management"]], ["product management", ["roadmap"]], ["communication", []], ["leadership", ["mentoring", "team lead"]],
  ["compliance", ["soc 2", "soc2", "iso 27001", "hipaa", "pci"]], ["cost optimization", ["finops", "cost management"]], ["disaster recovery", ["backup", "high availability"]],
  ["infrastructure as code", ["iac"]], ["automation", []], ["vmware", []], ["windows server", ["active directory"]], ["itil", []],
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const SKILL_RES = SKILLS.map(([name, alts]) => ({
  name,
  re: new RegExp(`(?<![\\p{L}\\p{N}+#])(?:${[name, ...alts].map(escapeRe).join("|")})(?![\\p{L}\\p{N}])`, "iu"),
}));

/** Skills found in a text, in the order of the list. */
export function extractSkills(text: string): string[] {
  return SKILL_RES.filter((s) => s.re.test(text)).map((s) => s.name);
}

const STOP = new Set("the and for with that this from your you our are will have has not but they their about into more than who what can all any one out use also per etc able work team role job company years year experience knowledge skills ability strong good great plus such including within across other new while where when which should would could may must need needs well make help build part full time".split(" "));

function words(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}+#.]+/gu) ?? []).map((w) => w.replace(/^[.]+|[.]+$/g, "")).filter(Boolean);
}

const OPTIONAL_AT = /(nice to have|preferred|bonus|a plus|good to have|desirable)/i;

export interface Match {
  /** 0 to 100. An estimate from skills and words, not a prediction of any employer's system. */
  score: number;
  matched: string[];
  missing: string[];
  /** Share of the job title's words found in the resume, 0 to 1. */
  titleFit: number;
  /** How the score was made, in plain words. */
  basis: "skills" | "words";
}

/** Match your resume to a job description. Skills asked for in the main part count double; "nice to have" skills count once. */
export function matchJob(resume: string, jd: { title: string; description: string }): Match {
  const resumeSkills = new Set(extractSkills(resume));
  const cut = jd.description.search(OPTIONAL_AT);
  const main = cut < 0 ? jd.description : jd.description.slice(0, cut);
  const optional = cut < 0 ? "" : jd.description.slice(cut);
  const required = new Set(extractSkills(`${jd.title} ${main}`));
  const nice = new Set(extractSkills(optional).filter((s) => !required.has(s)));
  const rw = new Set(words(resume));
  const titleWords = [...new Set(words(jd.title).filter((w) => w.length > 2 && !STOP.has(w)))];
  const titleFit = titleWords.length ? titleWords.filter((w) => rw.has(w)).length / titleWords.length : 0;

  const total = required.size * 2 + nice.size;
  if (required.size + nice.size >= 3) {
    const got = [...required].filter((s) => resumeSkills.has(s)).length * 2 + [...nice].filter((s) => resumeSkills.has(s)).length;
    const cov = got / total;
    const matched = [...required, ...nice].filter((s) => resumeSkills.has(s));
    const missing = [...required, ...nice].filter((s) => !resumeSkills.has(s));
    return { score: Math.round(100 * (0.75 * cov + 0.25 * titleFit)), matched, missing, titleFit, basis: "skills" };
  }
  // Few known skills in the posting: compare its repeated words with the resume.
  const freq = new Map<string, number>();
  for (const w of words(jd.description)) if (w.length > 3 && !STOP.has(w)) freq.set(w, (freq.get(w) ?? 0) + 1);
  const key = [...freq.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([w]) => w);
  const matched = key.filter((w) => rw.has(w));
  const missing = key.filter((w) => !rw.has(w));
  const cov = key.length ? matched.length / key.length : 0;
  return { score: Math.round(100 * (0.6 * cov + 0.4 * titleFit)), matched, missing, titleFit, basis: "words" };
}

export function scoreLabel(score: number): string {
  return score >= 75 ? "Strong match" : score >= 50 ? "Fair match" : "Weak match";
}

/**
 * What a tailored resume says that your own resume does not: skills (from the list above) and numbers.
 * The model is told not to add any, and this checks that it did not.
 */
export function newClaims(master: string, tailored: string): { skills: string[]; numbers: string[] } {
  const had = new Set(extractSkills(master));
  const skills = extractSkills(tailored).filter((s) => !had.has(s));
  const num = (t: string) => new Set(t.match(/\d[\d,.]*%?/g) ?? []);
  const mine = num(master);
  const numbers = [...num(tailored)].filter((n) => !mine.has(n));
  return { skills, numbers };
}

/** Honest first-pass check of the resume text itself, from rules ATS software commonly relies on. */
export function resumeChecks(text: string): { ok: boolean; label: string }[] {
  const t = text.trim();
  const has = (re: RegExp) => re.test(t);
  const wordsN = words(t).length;
  return [
    { ok: has(/[\w.+-]+@[\w-]+\.[\w.]+/), label: "Has an email address" },
    { ok: has(/(\+?\d[\d\s().-]{7,}\d)/), label: "Has a phone number" },
    { ok: has(/^\s*(experience|work experience|professional experience|employment)/im), label: "Has an Experience heading" },
    { ok: has(/^\s*(education|certifications?)/im), label: "Has an Education heading" },
    { ok: has(/^\s*(skills|technical skills|core skills)/im), label: "Has a Skills heading" },
    { ok: wordsN >= 200 && wordsN <= 900, label: `Length fits one or two pages (${wordsN} words)` },
    { ok: !has(/[│┃┆▪◆■□●]|\t{2,}/), label: "No table-like characters" },
  ];
}

export function ageLabel(posted: number | null, now = Date.now()): string {
  if (!posted) return "";
  const d = Math.floor((now - posted) / 86_400_000);
  return d <= 0 ? "today" : d === 1 ? "1 day ago" : d < 60 ? `${d} days ago` : `${Math.round(d / 30)} months ago`;
}

// ---- Saved state (this computer only) ----

export const STATUSES = ["saved", "preparing", "applied", "interview", "offer", "rejected"] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<Status, string> = { saved: "Saved", preparing: "Preparing", applied: "Applied", interview: "Interview", offer: "Offer", rejected: "Closed" };

export interface Application {
  id: string;
  title: string;
  company: string;
  url: string;
  status: Status;
  score: number;
  notes: string;
  /** Tailored resume for this job, if you made one. */
  resume?: string;
  /** Cover letter for this job, if you made one. */
  letter?: string;
  /** Interview date, YYYY-MM-DD. */
  interview?: string;
  /** Day to follow up, YYYY-MM-DD. */
  followUp?: string;
  updated: number;
}

export interface JobPrefs {
  categories: string[];
  keywords: string;
  remoteOnly: boolean;
  boards: string;
  /** Search again by itself when you open Jobs and the last search is old. Only while Kinviva is open. */
  agent: boolean;
}

export const DEFAULT_PREFS: JobPrefs = { categories: ["devops"], keywords: "", remoteOnly: false, boards: "", agent: false };
export const SEEN_KEY = "ml.jobs.seen1";
export const LAST_KEY = "ml.jobs.last1";
export const AGENT_EVERY_MS = 12 * 3_600_000;
export const RESUME_KEY = "ml.jobs.resume1";
export const APPS_KEY = "ml.jobs.apps1";
export const PREFS_KEY = "ml.jobs.prefs1";

const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

export function parseApps(raw: string | null): Application[] {
  try {
    const v = JSON.parse(raw ?? "[]");
    if (!Array.isArray(v)) return [];
    return v
      .filter((a) => a && typeof a.id === "string" && typeof a.title === "string" && (STATUSES as readonly string[]).includes(a.status))
      .map((a) => ({ id: a.id, title: a.title, company: String(a.company ?? ""), url: String(a.url ?? ""), status: a.status as Status, score: Number(a.score) || 0, notes: String(a.notes ?? ""), resume: typeof a.resume === "string" ? a.resume : undefined, letter: typeof a.letter === "string" ? a.letter : undefined, interview: isDay(a.interview) ? a.interview : undefined, followUp: isDay(a.followUp) ? a.followUp : undefined, updated: Number(a.updated) || 0 }));
  } catch {
    return [];
  }
}

export function parsePrefs(raw: string | null): JobPrefs {
  try {
    const v = JSON.parse(raw ?? "null") as Partial<JobPrefs> | null;
    if (!v) return { ...DEFAULT_PREFS };
    return {
      categories: Array.isArray(v.categories) ? v.categories.filter((c) => CATEGORIES.some((k) => k.id === c)) : DEFAULT_PREFS.categories,
      keywords: typeof v.keywords === "string" ? v.keywords : "",
      remoteOnly: v.remoteOnly === true,
      boards: typeof v.boards === "string" ? v.boards : "",
      agent: v.agent === true,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/** Company boards typed one per line or separated by commas. */
export function parseBoards(text: string): string[] {
  return text.split(/[\n,;]+/).map((b) => b.trim()).filter(Boolean).slice(0, 12);
}

/** Job ids from a saved list, safely. */
export function parseSeen(raw: string | null): string[] {
  try {
    const v = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 5000) : [];
  } catch {
    return [];
  }
}

/** Jobs not seen in an earlier search. With no earlier search nothing is "new", so the first run is not all marked. */
export function newJobIds(jobs: Job[], seen: string[], hadEarlierSearch: boolean): Set<string> {
  if (!hadEarlierSearch) return new Set();
  const old = new Set(seen);
  return new Set(jobs.filter((j) => !old.has(j.id)).map((j) => j.id));
}

/** The seen list after a search: everything seen before plus these jobs, newest 5000. */
export function mergeSeen(seen: string[], jobs: Job[]): string[] {
  return [...new Set([...jobs.map((j) => j.id), ...seen])].slice(0, 5000);
}

/** Whether the job agent should search now. */
export function agentDue(agentOn: boolean, lastMs: number | null, now = Date.now()): boolean {
  return agentOn && (lastMs === null || now - lastMs >= AGENT_EVERY_MS);
}

export interface Reminder {
  id: string;
  title: string;
  company: string;
  kind: "interview" | "follow-up";
  day: string;
  /** Days from today: negative is overdue. */
  inDays: number;
}

const dayNumber = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86_400_000);
export const todayKey = (now = Date.now()) => new Date(now - new Date(now).getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

/** Interviews and follow-ups that are overdue or within the next `ahead` days. Closed and offer rows are skipped. */
export function reminders(apps: Application[], now = Date.now(), ahead = 7): Reminder[] {
  const today = dayNumber(todayKey(now));
  const out: Reminder[] = [];
  for (const a of apps) {
    if (a.status === "rejected" || a.status === "offer") continue;
    for (const [kind, day] of [["interview", a.interview], ["follow-up", a.followUp]] as const) {
      if (!day) continue;
      const inDays = dayNumber(day) - today;
      if (inDays <= ahead) out.push({ id: a.id, title: a.title, company: a.company, kind, day, inDays });
    }
  }
  return out.sort((x, y) => x.inDays - y.inDays);
}

export function reminderLabel(r: Reminder): string {
  const when = r.inDays < 0 ? `${-r.inDays} day${r.inDays === -1 ? "" : "s"} overdue` : r.inDays === 0 ? "today" : r.inDays === 1 ? "tomorrow" : `in ${r.inDays} days`;
  return `${r.kind === "interview" ? "Interview" : "Follow up"} ${when}`;
}
