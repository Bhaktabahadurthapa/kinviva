import { describe, expect, it } from "vitest";
import { TEMPLATES, diffLines, headingOf, pageHint, parseResume, parseRole, usChecks, wordCount } from "./resume";

const TEXT = `Jane Doe
Austin, TX | (512) 555-0100 | jane@example.com | linkedin.com/in/janedoe
SUMMARY
Cloud engineer with AWS and Kubernetes.
TECHNICAL SKILLS
Cloud: AWS, Azure
Tools: Terraform, Docker
WORK EXPERIENCE
Site Reliability Engineer | Acme Corp | Austin, TX | Jan 2020 - Present
- Cut deploy time by 40% using CI/CD pipelines
- Ran on-call for 30 services
DevOps Engineer, Beta Inc, 2017-2019
• Built Terraform modules
• Moved builds to GitHub Actions
EDUCATION
BSc Computer Science, University of Texas, 2016
CERTIFICATIONS
AWS Solutions Architect Associate`;

describe("parseRole", () => {
  it("reads pipe and comma styles and tidies the dates", () => {
    expect(parseRole("Site Reliability Engineer | Acme Corp | Austin, TX | Jan 2020 - Present")).toEqual({ kind: "role", left: "Site Reliability Engineer", sub: "Acme Corp, Austin, TX", dates: "Jan 2020 – Present" });
    expect(parseRole("DevOps Engineer, Beta Inc, 2017-2019")).toEqual({ kind: "role", left: "DevOps Engineer", sub: "Beta Inc", dates: "2017 – 2019" });
    expect(parseRole("BSc Computer Science, University of Texas, 2016")).toMatchObject({ left: "BSc Computer Science", sub: "University of Texas", dates: "2016" });
  });
  it("does not make a role out of plain sentences", () => {
    expect(parseRole("Led a team of five engineers")).toBeNull();
    expect(parseRole("")).toBeNull();
  });
});

describe("parseResume", () => {
  const d = parseResume(TEXT);
  it("finds the name, the contact parts and the standard sections", () => {
    expect(d.name).toBe("Jane Doe");
    expect(d.contacts).toEqual(["Austin, TX", "(512) 555-0100", "jane@example.com", "linkedin.com/in/janedoe"]);
    expect(d.sections.map((s) => s.heading)).toEqual(["Summary", "Skills", "Experience", "Education", "Certifications"]);
  });
  it("groups bullets under their role and skills by group", () => {
    const exp = d.sections.find((s) => s.heading === "Experience")!;
    expect(exp.items.map((i) => i.kind)).toEqual(["role", "bullet", "bullet", "role", "bullet", "bullet"]);
    expect(d.sections[1].items[0]).toEqual({ kind: "skills", label: "Cloud", text: "AWS, Azure" });
  });
  it("keeps every line: nothing is dropped", () => {
    const all = JSON.stringify(d);
    for (const w of ["Cut deploy time by 40%", "Built Terraform modules", "AWS Solutions Architect Associate", "Cloud engineer with AWS and Kubernetes."]) expect(all).toContain(w);
  });
  it("copes with empty text", () => {
    expect(parseResume("")).toEqual({ name: "", contacts: [], sections: [] });
  });
  it("knows heading spellings", () => {
    expect(headingOf("Professional Experience:")).toBe("Experience");
    expect(headingOf("Hobbies and interests")).toBeNull();
  });
});

describe("US checks and length", () => {
  it("passes a US-style resume and flags a missing section or phone", () => {
    expect(usChecks(parseResume(TEXT), TEXT).every((c) => c.ok)).toBe(true);
    const bad = "Jane\njane@example.com\nSKILLS\nAWS\nDate of birth: 1990";
    const c = usChecks(parseResume(bad), bad);
    expect(c.filter((x) => !x.ok).length).toBeGreaterThanOrEqual(4);
  });
  it("gives a rough page hint", () => {
    expect(wordCount("a b  c")).toBe(3);
    expect(pageHint("word ".repeat(300), TEMPLATES[0])).toBe("about 1 page");
    expect(pageHint("word ".repeat(900), TEMPLATES[0])).toBe("about 2 pages");
    expect(pageHint("word ".repeat(2000), TEMPLATES[0])).toContain("more than 2");
  });
});

describe("diffLines", () => {
  it("shows added, removed and unchanged lines, ignoring spacing", () => {
    const d = diffLines("Jane\nSKILLS\nAWS, K8s\n- Cut deploy time", "Jane\nSKILLS\nAWS,  Kubernetes\n- Cut deploy time\n- New line");
    expect(d.map((x) => x.kind)).toEqual(["same", "same", "del", "add", "same", "add"]);
    expect(d[3].text).toBe("AWS,  Kubernetes");
  });
  it("is all same for identical text and handles empty input", () => {
    expect(diffLines("a\nb", "a\nb").every((x) => x.kind === "same")).toBe(true);
    expect(diffLines("", "x")).toEqual([{ kind: "add", text: "x" }]);
    expect(diffLines("", "")).toEqual([]);
  });
});
