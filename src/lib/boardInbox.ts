/** "Send to Whiteboard": text waiting to be drawn when the Whiteboard opens. */
type Item = { id: number; text: string };
let current: Item | null = null;
let counter = 0;
const listeners = new Set<() => void>();

export function sendToBoard(text: string) {
  current = { id: ++counter, text: text.trim().slice(0, 3000) };
  listeners.forEach((l) => l());
}
export const peekInbox = () => current;
export function subscribeInbox(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
