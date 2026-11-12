import { describe, expect, it } from "vitest";
import { DIGEST_KEY, agentDue, defaultBody, defaultSubject, digestRows, findEmails, parseDigest, parseSendLog, sentOn, ageLabel, extractSkills, matchJob, mergeSeen, newClaims, newJobIds, parseApps, parseBoards, parsePrefs, parseSeen, reminderLabel, reminders, resumeChecks, scoreLabel, type Application, type Job } from "./jobs";

const RESUME = `Jane Doe
jane@example.com | +1 512 555 0100
SUMMARY
Cloud engineer with AWS and Kubernetes.
SKILLS
AWS, K8s, Terraform, Python, GitHub Actions, Prometheus
EXPERIENCE
SRE, Acme, 2020-2024
- Cut deploy time by 40% using CI/CD pipelines
EDUCATION
BSc Computer Science`;

const JD = `We need a Senior DevOps Engineer.
Requirements: AWS, Kubernetes, Terraform, Docker and CI/CD. Experience with incident response.
Nice to have: Go, Datadog.`;

describe("skills", () => {
  it("finds skills and their other spellings without partial matches", () => {
    expect(extractSkills("K8s on EKS with Golang and CI CD")).toEqual(expect.arrayContaining(["kubernetes", "go", "ci/cd"]));
    expect(extractSkills("I like algorithms and gopher mascots")).toEqual([]);
    expect(extractSkills("C++ and C# and Node.js")).toEqual(expect.arrayContaining(["c++", "c#", "node.js"]));
  });
});

describe("matchJob", () => {
  it("scores skills, lists what matched and what is missing, and weights nice-to-haves lower", () => {
    const m = matchJob(RESUME, { title: "Senior DevOps Engineer", description: JD });
    expect(m.basis).toBe("skills");
    expect(m.matched).toEqual(expect.arrayContaining(["aws", "kubernetes", "terraform", "ci/cd"]));
    expect(m.missing).toEqual(expect.arrayContaining(["docker", "go", "datadog"]));
    expect(m.score).toBeGreaterThan(40);
    expect(m.score).toBeLessThan(90);
  });
  it("is deterministic and higher for a closer resume", () => {
    const j = { title: "DevOps Engineer", description: JD };
    expect(matchJob(RESUME, j)).toEqual(matchJob(RESUME, j));
    expect(matchJob("Chef with knife skills", j).score).toBeLessThan(matchJob(RESUME, j).score);
    expect(matchJob(RESUME + "\nDocker, Go, Datadog, incident response", j).score).toBeGreaterThan(matchJob(RESUME, j).score);
  });
  it("falls back to repeated words when the posting names few known skills", () => {
    const m = matchJob("Pastry chef, croissant and sourdough baking", { title: "Pastry Chef", description: "Bake sourdough daily. Sourdough and croissant production. Pastry station." });
    expect(m.basis).toBe("words");
    expect(m.score).toBeGreaterThan(40);
  });
  it("never leaves 0 to 100", () => {
    const s = matchJob("", { title: "", description: "" }).score;
    expect(s).toBeGreaterThanOrEqual(0);
    expect(matchJob(RESUME, { title: "x", description: "AWS Kubernetes Terraform" }).score).toBeLessThanOrEqual(100);
    expect(scoreLabel(80)).toBe("Strong match");
    expect(scoreLabel(10)).toBe("Weak match");
  });
});

describe("newClaims", () => {
  it("flags skills and numbers the tailored resume added", () => {
    const c = newClaims(RESUME, "Jane Doe\nSKILLS\nAWS, Kubernetes, Docker, Datadog\n- Cut deploy time by 40%\n- Saved $2,000,000");
    expect(c.skills).toEqual(expect.arrayContaining(["docker", "datadog"]));
    expect(c.skills).not.toContain("aws");
    expect(c.numbers).toContain("2,000,000");
    expect(c.numbers).not.toContain("40%");
  });
  it("is empty when nothing new was added", () => {
    expect(newClaims(RESUME, "AWS and Terraform, 40% faster")).toEqual({ skills: [], numbers: [] });
  });
});

describe("resumeChecks", () => {
  it("reports what an ATS commonly looks for", () => {
    const c = resumeChecks(RESUME);
    expect(c.find((x) => x.label.startsWith("Has an email"))?.ok).toBe(true);
    expect(c.find((x) => x.label.startsWith("Has a Skills"))?.ok).toBe(true);
    expect(resumeChecks("hello").some((x) => !x.ok)).toBe(true);
  });
});

describe("saved state", () => {
  it("reads saved applications and preferences safely", () => {
    expect(parseApps("nope")).toEqual([]);
    expect(parseApps(JSON.stringify([{ id: "a", title: "T", status: "applied" }, { id: "b", title: "U", status: "bogus" }, 5]))).toHaveLength(1);
    expect(parsePrefs(null).categories).toEqual(["devops"]);
    expect(parsePrefs(JSON.stringify({ categories: ["data", "zzz"], remoteOnly: true })).categories).toEqual(["data"]);
    expect(parseBoards("greenhouse:stripe, lever:netflix\nbad ")).toEqual(["greenhouse:stripe", "lever:netflix", "bad"]);
  });
  it("describes how old a posting is", () => {
    const now = Date.parse("2026-11-10T00:00:00Z");
    expect(ageLabel(now - 3 * 86_400_000, now)).toBe("3 days ago");
    expect(ageLabel(null, now)).toBe("");
  });
});

const J = (id: string): Job => ({ id, title: id, company: "", location: "", url: "https://x.io", description: "d", source: "s", posted_ms: null, remote: false });
const A = (over: Partial<Application>): Application => ({ id: "a", title: "SRE", company: "Acme", url: "", status: "applied", score: 0, notes: "", updated: 0, ...over });

describe("job agent", () => {
  it("marks only jobs not seen before, and nothing on the first search", () => {
    expect([...newJobIds([J("a"), J("b")], ["a"], true)]).toEqual(["b"]);
    expect(newJobIds([J("a")], [], false).size).toBe(0);
    expect(mergeSeen(["a"], [J("b"), J("a")])).toEqual(["b", "a"]);
    expect(parseSeen("nope")).toEqual([]);
    expect(parseSeen('["x",1]')).toEqual(["x"]);
  });
  it("searches by itself only when on and the last search is old", () => {
    const now = 1_000_000_000_000;
    expect(agentDue(false, null, now)).toBe(false);
    expect(agentDue(true, null, now)).toBe(true);
    expect(agentDue(true, now - 3_600_000, now)).toBe(false);
    expect(agentDue(true, now - 13 * 3_600_000, now)).toBe(true);
    expect(parsePrefs(JSON.stringify({ agent: true })).agent).toBe(true);
    expect(parsePrefs(null).agent).toBe(false);
  });
});

describe("reminders", () => {
  const now = Date.parse("2026-11-10T12:00:00Z");
  it("lists overdue and soon-due interviews and follow-ups, oldest first, and skips closed ones", () => {
    const r = reminders([
      A({ id: "1", interview: "2026-11-12" }),
      A({ id: "2", followUp: "2026-11-08" }),
      A({ id: "3", interview: "2026-12-30" }),
      A({ id: "4", status: "rejected", followUp: "2026-11-09" }),
      A({ id: "5", status: "offer", interview: "2026-11-11" }),
    ], now);
    expect(r.map((x) => [x.id, x.kind])).toEqual([["2", "follow-up"], ["1", "interview"]]);
    expect(reminderLabel(r[0])).toBe("Follow up 2 days overdue");
    expect(reminderLabel(r[1])).toBe("Interview in 2 days");
  });
  it("reads saved dates safely", () => {
    const [a] = parseApps(JSON.stringify([{ id: "a", title: "T", status: "applied", interview: "2026-11-12", followUp: "soon", letter: "Dear" }]));
    expect(a.interview).toBe("2026-11-12");
    expect(a.followUp).toBeUndefined();
    expect(a.letter).toBe("Dear");
  });
});

describe("morning digest and sending helpers", () => {
  it("finds the addresses a posting names", () => {
    expect(findEmails("Apply: Careers@Acme.com. Or hr@beta.io, or careers@acme.com!")).toEqual(["careers@acme.com", "hr@beta.io"]);
    expect(findEmails("no address, 100% remote")).toEqual([]);
  });
  it("reads a stored digest and send log safely", () => {
    expect(parseDigest("nope")).toBeNull();
    expect(parseDigest(null)).toBeNull();
    const d = parseDigest(JSON.stringify({ day: "2026-11-12", at_ms: 5, total: 9, jobs: [J("a"), { bad: 1 }] }))!;
    expect(d.jobs.map((j) => j.id)).toEqual(["a"]);
    expect(d.total).toBe(9);
    expect(parseSendLog("x")).toEqual([]);
    expect(sentOn(parseSendLog(JSON.stringify([{ app_id: "a", day: "d1", to: "", subject: "", at_ms: 1 }, { app_id: "b", day: "d2", to: "", subject: "", at_ms: 1 }])), "d1")).toBe(1);
    expect(DIGEST_KEY).toBe("digest");
  });
  it("hides skipped and already-started jobs and puts the best match first", () => {
    const strong = { ...J("strong"), title: "DevOps Engineer", description: "AWS Kubernetes Terraform Docker CI/CD" };
    const weak = { ...J("weak"), title: "Chef", description: "Cooking" };
    const d = { day: "d", at_ms: 1, total: 3, jobs: [weak, strong, J("skip"), J("started")] };
    const rows = digestRows(d, RESUME, ["skip"], [A({ id: "started" })]);
    expect(rows.map((r) => r.job.id)).toEqual(["strong", "weak"]);
    expect(digestRows(null, RESUME, [], [])).toEqual([]);
  });
  it("writes a sensible default subject and body", () => {
    expect(defaultSubject("SRE", "Jane Doe")).toBe("Application: SRE, Jane Doe");
    expect(defaultBody("Dear Team,\nHi.", "SRE", "Acme", "Jane")).toBe("Dear Team,\nHi.");
    expect(defaultBody(undefined, "SRE", "Acme", "Jane")).toContain("SRE position at Acme");
    expect(defaultBody("  ", "SRE", "", "Jane")).not.toContain("at ");
  });
});
