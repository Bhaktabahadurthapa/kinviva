/** Only the newest request may show its result; answers from older ones are ignored. */
export function latestGuard() {
  let n = 0;
  return {
    next: () => ++n,
    isCurrent: (id: number) => id === n,
    invalidate: () => void n++,
  };
}
