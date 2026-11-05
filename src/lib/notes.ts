import { api } from "./api";
import { newId, type AppRecord } from "./platform";

/** Titles for a saved piece of text: first line, trimmed. */
export function titleFrom(text: string, fallback = "Note"): string {
  const first = text.split("\n").map((l) => l.replace(/^[#>*\-\s]+/, "").trim()).find(Boolean) ?? "";
  return (first || fallback).slice(0, 80);
}

/** Keeps a piece of an answer or transcript as a note (plain text; highlight markers removed). */
export async function saveToNotes(text: string, opts: { title?: string; meetingId?: string | null } = {}): Promise<AppRecord> {
  const body = text.replace(/\*\*([^*\n]+?)\*\*/g, "$1").trim();
  return api.recordSave({ id: newId(), kind: "note", title: opts.title ?? titleFrom(body), body, meeting_id: opts.meetingId ?? null });
}
