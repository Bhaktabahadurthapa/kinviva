import { describe, expect, it } from "vitest";
import { initialInterview, interviewReducer, latestQuestion, type InterviewState } from "./interview";
import type { InterviewEvent } from "./types";

const ev = (id: string, state: InterviewEvent["state"], extra: Partial<InterviewEvent> = {}): InterviewEvent => ({
  request_id: id,
  category: "coding",
  mode: "explain",
  skill: "coding-interview",
  state,
  received_chars: 0,
  result: null,
  fallback_text: null,
  error: null,
  ...extra,
});
const answer = { kind: "answer" as const, say_it: "s", understand_it: "u", code: null, tradeoffs: [], follow_up: "f" };

const run = (s: InterviewState, id: string, key = "k") => {
  s = interviewReducer(s, { type: "starting", mode: "explain", inputKey: key });
  return interviewReducer(s, { type: "started", mode: "explain", requestId: id });
};

describe("interviewReducer", () => {
  it("shows a result only for the request that owns the slot", () => {
    let s = run(initialInterview, "a");
    s = interviewReducer(s, { type: "event", event: ev("a", "done", { result: answer }) });
    expect(s.slots.explain.status).toBe("done");
    expect(s.slots.explain.result).toEqual(answer);
  });

  it("drops a late result from a replaced request (stale response)", () => {
    let s = run(initialInterview, "old", "q1");
    s = run(s, "new", "q2"); // user changed the question and asked again
    s = interviewReducer(s, { type: "event", event: ev("old", "done", { result: { ...answer, say_it: "OLD" } }) });
    expect(["starting", "streaming"]).toContain(s.slots.explain.status);
    expect(s.slots.explain.result).toBeNull();
    s = interviewReducer(s, { type: "event", event: ev("new", "done", { result: answer }) });
    expect(s.slots.explain.result?.kind === "answer" && s.slots.explain.result.say_it).toBe("s");
  });

  it("keeps events that arrive before the request id is known", () => {
    let s = interviewReducer(initialInterview, { type: "starting", mode: "explain", inputKey: "k" });
    s = interviewReducer(s, { type: "event", event: ev("a", "done", { result: answer }) });
    expect(s.slots.explain.status).toBe("starting");
    s = interviewReducer(s, { type: "started", mode: "explain", requestId: "a" });
    expect(s.slots.explain.status).toBe("done");
  });

  it("ignores unknown events when nothing is waiting", () => {
    const s = interviewReducer(initialInterview, { type: "event", event: ev("zzz", "done", { result: answer }) });
    expect(s).toEqual(initialInterview);
  });

  it("reports provider errors, cancellation and the plain-text fallback", () => {
    let s = run(initialInterview, "a");
    s = interviewReducer(s, { type: "event", event: ev("a", "error", { error: "The API key was rejected." }) });
    expect(s.slots.explain).toMatchObject({ status: "error", error: "The API key was rejected." });
    s = run(s, "b");
    s = interviewReducer(s, { type: "event", event: ev("b", "done", { fallback_text: "plain", error: "not structured" }) });
    expect(s.slots.explain).toMatchObject({ status: "done", result: null, fallbackText: "plain" });
    s = run(s, "c");
    s = interviewReducer(s, { type: "cancel", mode: "explain" });
    s = interviewReducer(s, { type: "event", event: ev("c", "done", { result: answer }) });
    expect(s.slots.explain.status).toBe("cancelled");
    expect(s.slots.explain.result).toBeNull();
  });

  it("start failure (for example a missing API key) is shown", () => {
    let s = interviewReducer(initialInterview, { type: "starting", mode: "explain", inputKey: "k" });
    s = interviewReducer(s, { type: "startFailed", mode: "explain", error: "Add your AI provider API key in Settings → AI." });
    expect(s.slots.explain.status).toBe("error");
  });

  it("starting the other mode cancels the one in flight", () => {
    let s = run(initialInterview, "a");
    s = interviewReducer(s, { type: "starting", mode: "practice", inputKey: "k" });
    expect(s.slots.explain.status).toBe("cancelled");
    s = interviewReducer(s, { type: "event", event: ev("a", "done", { result: answer }) });
    expect(s.slots.explain.result).toBeNull();
  });
});

describe("latestQuestion", () => {
  const finals = [
    { source: "system", text: "Walk me through failover?" },
    { source: "mic", text: "Sure" },
    { source: "system", text: "Okay thanks" },
  ];
  it("prefers the detected question, then the last question, then the last line", () => {
    expect(latestQuestion("  What is RAG? ", finals)).toBe("What is RAG?");
    expect(latestQuestion(null, finals)).toBe("Walk me through failover?");
    expect(latestQuestion(null, [{ source: "system", text: "Tell me about yourself" }])).toBe("Tell me about yourself");
    expect(latestQuestion(null, [])).toBe("");
  });
});
