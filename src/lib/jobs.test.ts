import { describe, expect, it } from "vitest";
import { ageLabel, extractSkills, matchJob, newClaims, parseApps, parseBoards, parsePrefs, resumeChecks, scoreLabel } from "./jobs";

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
