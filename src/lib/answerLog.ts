import { createContext, useSyncExternalStore } from "react";

/** Every answer you asked for (Explain, Suggest reply, Ask, Recap) stays here, so old ones can be found again after new ones arrive. */
export interface LoggedAnswer { id: string; action: string; question: string; text: string; at: number }

let log: LoggedAnswer[] = [];
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function addAnswer(a: LoggedAnswer) {
  if (log.some((x) => x.id === a.id)) return;
  log = [a, ...log].slice(0, 60);
  emit();
}
export function clearAnswers() {
  if (!log.length) return;
  log = [];
  emit();
}
export function useAnswerLog(): LoggedAnswer[] {
  return useSyncExternalStore((f) => (subs.add(f), () => void subs.delete(f)), () => log);
}

/** The words typed in the results search box. */
export const FeedSearch = createContext("");
