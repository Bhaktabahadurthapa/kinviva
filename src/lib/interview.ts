import type { InterviewEvent, InterviewMode, InterviewParsed } from "./types";

/** What the user sees for one mode of the Interview Practice screen. */
export interface Slot {
  requestId: string | null;
  status: "idle" | "starting" | "streaming" | "done" | "error" | "cancelled";
  received: number;
  result: InterviewParsed | null;
  fallbackText: string | null;
  error: string | null;
  /** The inputs this result was produced for, to flag it when they change. */
  inputKey: string;
}

export interface InterviewState {
  slots: Record<InterviewMode, Slot>;
  /** Events that arrived before the backend returned the request id. */
  early: InterviewEvent[];
}

const empty = (): Slot => ({ requestId: null, status: "idle", received: 0, result: null, fallbackText: null, error: null, inputKey: "" });
export const initialInterview: InterviewState = { slots: { explain: empty(), practice: empty() }, early: [] };

export type InterviewAction =
  | { type: "starting"; mode: InterviewMode; inputKey: string }
  | { type: "started"; mode: InterviewMode; requestId: string }
  | { type: "startFailed"; mode: InterviewMode; error: string }
  | { type: "event"; event: InterviewEvent }
  | { type: "cancel"; mode: InterviewMode }
  | { type: "clear" };

function apply(slot: Slot, e: InterviewEvent): Slot {
  if (e.state === "streaming") return { ...slot, status: "streaming", received: Math.max(slot.received, e.received_chars) };
  if (e.state === "done")
    return { ...slot, status: "done", received: e.received_chars, result: e.result, fallbackText: e.fallback_text, error: e.error };
  if (e.state === "error") return { ...slot, status: "error", error: e.error ?? "The request failed." };
  return { ...slot, status: "cancelled" };
}

/**
 * A request only updates the slot that owns its id. Events from replaced or
 * cancelled requests find no owner and are dropped, so a slow answer to an old
 * question can never overwrite the current one.
 */
export function interviewReducer(state: InterviewState, a: InterviewAction): InterviewState {
  switch (a.type) {
    case "starting": {
      // Only one request runs at a time (the backend replaces the previous one).
      const slots = { ...state.slots };
      for (const m of ["explain", "practice"] as const) {
        const s = slots[m];
        if (m !== a.mode && (s.status === "streaming" || s.status === "starting")) slots[m] = { ...s, status: "cancelled", requestId: null };
      }
      slots[a.mode] = { ...empty(), status: "starting", inputKey: a.inputKey };
      return { slots, early: [] };
    }
    case "started": {
      let slot: Slot = { ...state.slots[a.mode], requestId: a.requestId };
      for (const e of state.early.filter((e) => e.request_id === a.requestId)) slot = apply(slot, e);
      return { slots: { ...state.slots, [a.mode]: slot }, early: [] };
    }
    case "startFailed":
      return { ...state, slots: { ...state.slots, [a.mode]: { ...state.slots[a.mode], status: "error", error: a.error, requestId: null } } };
    case "event": {
      const e = a.event;
      const mode = (["explain", "practice"] as const).find((m) => state.slots[m].requestId === e.request_id);
      if (!mode) {
        const waiting = Object.values(state.slots).some((s) => s.status === "starting");
        return waiting ? { ...state, early: [...state.early, e].slice(-20) } : state;
      }
      return { ...state, slots: { ...state.slots, [mode]: apply(state.slots[mode], e) } };
    }
    case "cancel":
      return { ...state, slots: { ...state.slots, [a.mode]: { ...state.slots[a.mode], status: "cancelled", requestId: null } } };
    case "clear":
      return initialInterview;
  }
}

export const isBusy = (s: Slot) => s.status === "starting" || s.status === "streaming";

/** Newest question worth practising from the live transcript: a detected question, else the last line from "Them". */
export function latestQuestion(detected: string | null | undefined, finals: { source: string; text: string }[]): string {
  if (detected?.trim()) return detected.trim();
  const them = finals.filter((f) => f.source === "system" && f.text.trim());
  const q = [...them].reverse().find((f) => f.text.includes("?"));
  return (q ?? them[them.length - 1])?.text.trim() ?? "";
}
