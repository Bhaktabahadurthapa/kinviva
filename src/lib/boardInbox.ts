/** "Send to Whiteboard": text waiting to be drawn when the Whiteboard opens. */
export interface InboxOptions { meetingId?: string | null; style?: string; title?: string; /** add the diagram to the board without waiting for a click */ auto?: boolean }
type Item = { id: number; text: string } & InboxOptions;
let current: Item | null = null;
let counter = 0;
const listeners = new Set<() => void>();

export function sendToBoard(text: string, opts: InboxOptions = {}) {
  current = { id: ++counter, text: text.trim().slice(0, 3000), ...opts };
  listeners.forEach((l) => l());
}
export const peekInbox = () => current;
export function subscribeInbox(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
