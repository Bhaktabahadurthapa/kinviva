import type { AiSlot, Slot } from "../lib/types";
export type { AiAction } from "../lib/types";
export interface LiveStateLike {
  ai: Partial<Record<Slot, AiSlot>>;
}
