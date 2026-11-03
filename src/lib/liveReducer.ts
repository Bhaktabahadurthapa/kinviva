import type { AiEvent, AiSlot, MeetingStatus, Segment, Slot, Snapshot, Source, Transcript } from "./types";

export interface LiveState {
  ready: boolean;
  status: MeetingStatus | null;
  transcript: Transcript;
  notes: string;
  ai: Partial<Record<Slot, AiSlot>>;
  levels: Partial<Record<Source, number>>;
  question: { text: string; at: number } | null;
  /** Automatic answers keyed by the "Them" segment they explain. */
  side: Record<number, SideNote>;
}

export interface SideNote {
  meaning?: AiSlot;
  answer?: AiSlot;
}

export const initialLive: LiveState = {
  ready: false,
  status: null,
  transcript: { finals: [], partials: {} },
  notes: "",
  ai: {},
  levels: {},
  question: null,
  side: {},
};

export type LiveEvent =
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "status"; status: MeetingStatus }
  | { type: "partial"; source: Source; text: string }
  | { type: "final"; segment: Segment }
  | { type: "ai"; event: AiEvent }
  | { type: "levels"; levels: Partial<Record<Source, number>> }
  | { type: "question"; text: string; at: number }
  | { type: "dismissQuestion" }
  | { type: "notes"; notes: string };

export function liveReducer(state: LiveState, ev: LiveEvent): LiveState {
  switch (ev.type) {
    case "snapshot":
      return {
        ...state,
        ready: true,
        status: ev.snapshot.status,
        transcript: ev.snapshot.transcript,
        notes: ev.snapshot.notes,
        ai: ev.snapshot.ai,
      };
    case "status": {
      // A new meeting starting clears the previous transcript and answers.
      const started =
        ev.status.meeting_id !== null && ev.status.meeting_id !== state.status?.meeting_id;
      return {
        ...state,
        status: ev.status,
        transcript: started ? { finals: [], partials: {} } : state.transcript,
        ai: started ? {} : state.ai,
        notes: started ? "" : state.notes,
        levels: ev.status.state === "running" ? state.levels : {},
        question: started ? null : state.question,
        side: started ? {} : state.side,
      };
    }
    case "partial": {
      const partials = { ...state.transcript.partials };
      if (ev.text.trim()) partials[ev.source] = ev.text.trim();
      else delete partials[ev.source];
      return { ...state, transcript: { ...state.transcript, partials } };
    }
    case "final": {
      // Ignore duplicates (e.g. the event and a snapshot racing).
      if (ev.segment.id >= 0 && state.transcript.finals.some((s) => s.id === ev.segment.id)) return state;
      const partials = { ...state.transcript.partials };
      delete partials[ev.segment.source];
      return {
        ...state,
        transcript: { finals: [...state.transcript.finals, ev.segment], partials },
      };
    }
    case "ai": {
      const { slot, ...rest } = ev.event;
      const prev = state.ai[slot];
      // Drop stale events from a request that has been replaced.
      // Side notes are keyed by their own line, so they always update.
      let side = state.side;
      if (rest.auto && rest.segment_id !== null) {
        const key = slot === "reply" ? "answer" : "meaning";
        side = { ...side, [rest.segment_id]: { ...side[rest.segment_id], [key]: rest } };
      }
      if (prev && prev.request_id && rest.request_id !== prev.request_id && rest.state !== "streaming") return { ...state, side };
      return { ...state, ai: { ...state.ai, [slot]: rest }, side };
    }
    case "levels":
      return { ...state, levels: ev.levels };
    case "question":
      return { ...state, question: { text: ev.text, at: ev.at } };
    case "dismissQuestion":
      return { ...state, question: null };
    case "notes":
      return { ...state, notes: ev.notes };
  }
}
