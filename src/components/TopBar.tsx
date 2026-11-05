import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { Tab } from "../lib/nav";
import type { SearchHit } from "../lib/platform";
import type { Settings } from "../lib/types";

const KIND_LABEL: Record<string, string> = {
  session: "Session", transcript: "Transcript", note: "Note", whiteboard: "Whiteboard", chart: "Chart", incident: "Incident",
  diagram: "Diagram", document: "Document", learning: "Learning", discover: "Discover",
};
export const HIT_TAB: Record<string, Tab> = {
  session: "sessions", transcript: "sessions", note: "notes", whiteboard: "whiteboard", chart: "visuals", incident: "technical",
  diagram: "architecture", document: "documents", learning: "learning", discover: "discover",
};

/** Search across everything stored on this computer, plus the profile shortcut. */
export function TopBar({ settings, onOpenHit, onSettings }: { settings: Settings | null; onOpenHit: (h: SearchHit) => void; onSettings: () => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mine = ++seq.current;
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = window.setTimeout(() => {
      api.globalSearch(q).then((r) => mine === seq.current && setHits(r)).catch(() => mine === seq.current && setHits([]));
    }, 180);
    return () => window.clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  const initial = (settings?.profile_role || "Me").trim().charAt(0).toUpperCase();
  return (
    <div className="topbar">
      <div className="topbar-search" ref={box}>
        <input
          type="search"
          value={q}
          placeholder="Search sessions, notes, documents, diagrams…"
          aria-label="Search everything"
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => e.key === "Escape" && (setOpen(false), (e.target as HTMLInputElement).blur())}
        />
        {open && q.trim().length >= 2 && (
          <div className="search-pop" role="listbox">
            {hits.length === 0 ? (
              <p className="hint">Nothing found for “{q.trim()}”.</p>
            ) : (
              hits.map((h) => (
                <button key={`${h.kind}${h.id}`} role="option" aria-selected="false" className="search-hit" onClick={() => { setOpen(false); setQ(""); onOpenHit(h); }}>
                  <span className="search-kind">{KIND_LABEL[h.kind] ?? h.kind}</span>
                  <span className="search-title">{h.title}</span>
                  {h.snippet && <span className="search-snip">{h.snippet}</span>}
                </button>
              ))
            )}
          </div>
        )}
      </div>
      <button className="topbar-profile" onClick={onSettings} title={settings?.profile_role ? `${settings.profile_role}: open settings` : "Open settings"} aria-label="Settings and profile">
        <span className="avatar" aria-hidden>{initial}</span>
      </button>
    </div>
  );
}
