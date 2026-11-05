import { useRef } from "react";
import { clampSplit, MAX_SPLIT, MIN_SPLIT, splitFromPointer } from "../lib/split";

/** Drag (or use the arrow keys) to resize the panel on its left. */
export function Splitter({ value, onChange, container, reset = 45 }: { value: number; onChange: (v: number) => void; container: React.RefObject<HTMLElement>; reset?: number }) {
  const dragging = useRef(false);
  const move = (e: React.PointerEvent) => {
    if (!dragging.current || !container.current) return;
    const r = container.current.getBoundingClientRect();
    onChange(splitFromPointer(e.clientX, r.left, r.width));
  };
  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panels"
      aria-valuemin={MIN_SPLIT}
      aria-valuemax={MAX_SPLIT}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={move}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
      onDoubleClick={() => onChange(reset)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onChange(clampSplit(value - 3));
        else if (e.key === "ArrowRight") onChange(clampSplit(value + 3));
        else return;
        e.preventDefault();
      }}
    />
  );
}
