import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useReducer } from "react";
import { api, inTauri } from "./api";
import { initialLive, liveReducer } from "./liveReducer";
import type { AiEvent, MeetingStatus, Segment, Source } from "./types";

/** Live meeting state, kept in sync with the backend in every window. */
export function useLive() {
  const [state, dispatch] = useReducer(liveReducer, initialLive);

  const refresh = useCallback(async () => {
    if (!inTauri) return;
    dispatch({ type: "snapshot", snapshot: await api.getSnapshot() });
  }, []);

  useEffect(() => {
    if (!inTauri) return;
    const subs: Promise<UnlistenFn>[] = [
      listen<MeetingStatus>("meeting-status", (e) => dispatch({ type: "status", status: e.payload })),
      listen<{ source: Source; text: string }>("transcript-partial", (e) =>
        dispatch({ type: "partial", source: e.payload.source, text: e.payload.text }),
      ),
      listen<Segment>("transcript-final", (e) => dispatch({ type: "final", segment: e.payload })),
      listen<AiEvent>("ai-event", (e) => dispatch({ type: "ai", event: e.payload })),
      listen<Partial<Record<Source, number>>>("audio-levels", (e) => dispatch({ type: "levels", levels: e.payload })),
      listen<{ text: string }>("question-detected", (e) =>
        dispatch({ type: "question", text: e.payload.text, at: Date.now() }),
      ),
      listen<string>("notes-changed", (e) => dispatch({ type: "notes", notes: e.payload })),
      listen("snapshot-changed", () => void refresh()),
    ];
    void refresh();
    return () => subs.forEach((p) => p.then((un) => un()));
  }, [refresh]);

  return { state, dispatch, refresh };
}
