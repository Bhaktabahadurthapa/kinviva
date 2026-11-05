import { describe, expect, it } from "vitest";
import { defaultSession, sessionProblem } from "./session";

describe("sessionProblem", () => {
  it("only class sessions need a course", () => {
    expect(sessionProblem(defaultSession, [])).toBeNull();
    expect(sessionProblem({ kind: "work", courseId: null, week: null }, [])).toBeNull();
  });
  it("asks for a course when none exists or none is chosen", () => {
    expect(sessionProblem({ kind: "class", courseId: null, week: null }, [])).toContain("Create a course");
    expect(sessionProblem({ kind: "class", courseId: null, week: 2 }, ["a"])).toContain("Choose a course");
    expect(sessionProblem({ kind: "class", courseId: "gone", week: null }, ["a"])).toContain("Choose a course");
    expect(sessionProblem({ kind: "class", courseId: "a", week: 3 }, ["a"])).toBeNull();
  });
});
