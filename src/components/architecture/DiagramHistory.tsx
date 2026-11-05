import type { DiagramRecord } from "../../lib/architecture";

const when = (ms: number) => new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** Saved diagrams, newest first. */
export function DiagramHistory({ items, activeId, onOpen, onDelete }: { items: DiagramRecord[]; activeId: string | null; onOpen: (d: DiagramRecord) => void; onDelete: (d: DiagramRecord) => void }) {
  if (!items.length) return <p className="hint">Saved diagrams appear here.</p>;
  return (
    <ul className="arch-history">
      {items.map((d) => (
        <li key={d.id} className={d.id === activeId ? "active" : ""}>
          <button className="arch-history-open" onClick={() => onOpen(d)}>
            <strong>{d.title}</strong>
            <span>{when(d.created_at)} · {d.kind}{d.origin === "edited" ? " · edited" : ""}</span>
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => onDelete(d)} aria-label={`Delete ${d.title}`}>Delete</button>
        </li>
      ))}
    </ul>
  );
}
