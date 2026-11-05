import type { SessionKind } from "./types";

export interface SessionChoice {
  kind: SessionKind;
  courseId: string | null;
  week: number | null;
}

export const defaultSession: SessionChoice = { kind: "general", courseId: null, week: null };
const KEY = "ml.session";

export function loadSession(): SessionChoice {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (v && ["class", "work", "general"].includes(v.kind)) {
      return { kind: v.kind, courseId: typeof v.courseId === "string" ? v.courseId : null, week: typeof v.week === "number" ? v.week : null };
    }
  } catch {
    /* storage unavailable: fall back to the default */
  }
  return defaultSession;
}

export function saveSession(s: SessionChoice) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* not essential */
  }
}

/** Why a session cannot start yet, or null when it can. */
export function sessionProblem(s: SessionChoice, courseIds: string[]): string | null {
  if (s.kind !== "class") return null;
  if (courseIds.length === 0) return "Create a course first (Meeting → Resources), then start a class session.";
  if (!s.courseId || !courseIds.includes(s.courseId)) return "Choose a course for this class session.";
  return null;
}

export const KIND_LABEL: Record<SessionKind, string> = { class: "Class", work: "Work", general: "General" };
