import { describe, expect, it } from "vitest";
import { initialLive, liveReducer } from "./liveReducer";
import type { AiEvent, MeetingStatus, SourceStatus } from "./types";

const src: SourceStatus = { enabled: true, capture: "capturing", stt: "connected", device: null, message: null };
const status = (id: string | null, state: MeetingStatus["state"] = "running"): MeetingStatus => ({
  state,
  meeting_id: id,
  title: "t",
  started_at: 1,
  mic: src,
  system: src,
  stt_provider: "deepgram",
  audio_to_cloud: true,
  stt_host: "api.deepgram.com",
  recording_audio: false,
  context_meeting_id: null,
  context_is_demo: false,
});

describe("liveReducer transcript handling", () => {
  it("partial is replaced by the final for the same source only", () => {
    let s = liveReducer(initialLive, { type: "status", status: status("m1") });
    s = liveReducer(s, { type: "partial", source: "system", text: "what is" });
    s = liveReducer(s, { type: "partial", source: "mic", text: "um" });
    s = liveReducer(s, { type: "final", segment: { id: 1, source: "system", text: "What is it?", start_ms: 0, end_ms: 1 } });
    expect(s.transcript.partials).toEqual({ mic: "um" });
    expect(s.transcript.finals.map((f) => f.text)).toEqual(["What is it?"]);
  });

  it("ignores duplicate finals and clears on blank partial", () => {
    let s = liveReducer(initialLive, { type: "status", status: status("m1") });
    const seg = { id: 7, source: "mic" as const, text: "hi", start_ms: 0, end_ms: 1 };
    s = liveReducer(s, { type: "final", segment: seg });
    s = liveReducer(s, { type: "final", segment: seg });
    expect(s.transcript.finals).toHaveLength(1);
    s = liveReducer(s, { type: "partial", source: "mic", text: "x" });
    s = liveReducer(s, { type: "partial", source: "mic", text: "  " });
    expect(s.transcript.partials).toEqual({});
  });

  it("a new meeting clears the previous transcript; stopping keeps it", () => {
    let s = liveReducer(initialLive, { type: "status", status: status("m1") });
    s = liveReducer(s, { type: "final", segment: { id: 1, source: "mic", text: "a", start_ms: 0, end_ms: 1 } });
    s = liveReducer(s, { type: "status", status: { ...status(null, "idle"), context_meeting_id: "m1" } });
    expect(s.transcript.finals).toHaveLength(1);
    s = liveReducer(s, { type: "status", status: status("m2") });
    expect(s.transcript.finals).toHaveLength(0);
  });

  it("drops late events from a replaced AI request", () => {
    const ev = (id: string, state: AiEvent["state"], text: string): AiEvent => ({
      slot: "reply", request_id: id, action: "suggest", state, text, error: null, sources: [], destination: null, question: null, auto: false, segment_id: null,
    });
    let s = liveReducer(initialLive, { type: "ai", event: ev("a", "streaming", "old") });
    s = liveReducer(s, { type: "ai", event: ev("b", "streaming", "") });
    s = liveReducer(s, { type: "ai", event: ev("a", "cancelled", "old") });
    expect(s.ai.reply?.request_id).toBe("b");
    s = liveReducer(s, { type: "ai", event: ev("b", "done", "new") });
    expect(s.ai.reply?.text).toBe("new");
  });
});

describe("side-by-side automatic answers", () => {
  it("keeps each automatic answer next to the line it explains", () => {
    const ev = (id: string, slot: "meaning" | "reply", seg: number, text: string, state: AiEvent["state"] = "done"): AiEvent => ({
      slot, request_id: id, action: slot === "reply" ? "suggest" : "explain", state, text,
      error: null, sources: [], destination: null, question: null, auto: true, segment_id: seg,
    });
    let s = liveReducer(initialLive, { type: "ai", event: ev("a", "meaning", 1, "first meaning") });
    // The backend always announces a new request as streaming before it finishes.
    s = liveReducer(s, { type: "ai", event: ev("b", "meaning", 2, "", "streaming") });
    s = liveReducer(s, { type: "ai", event: ev("b", "meaning", 2, "second meaning") });
    s = liveReducer(s, { type: "ai", event: ev("c", "reply", 2, "an answer") });
    expect(s.side[1].meaning?.text).toBe("first meaning");
    expect(s.side[2].meaning?.text).toBe("second meaning");
    expect(s.side[2].answer?.text).toBe("an answer");
    // The panels still show the latest.
    expect(s.ai.meaning?.text).toBe("second meaning");
  });

  it("manual answers do not attach to a line", () => {
    const manual: AiEvent = {
      slot: "meaning", request_id: "m", action: "explain", state: "done", text: "x",
      error: null, sources: [], destination: null, question: null, auto: false, segment_id: null,
    };
    expect(liveReducer(initialLive, { type: "ai", event: manual }).side).toEqual({});
  });
});
