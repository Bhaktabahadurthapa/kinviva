import { useEffect, useRef, useState } from "react";
import { api, errorText } from "../lib/api";
import type { SearchHit } from "../lib/platform";

const LABEL: Record<string, string> = {
  session: "Sessions", transcript: "Transcripts", note: "Notes", whiteboard: "Whiteboards", chart: "Charts", incident: "Incidents",
  diagram: "Diagrams", document: "Documents", learning: "Learning", discover: "Discover",
};

/** One search box over everything stored on this computer. */
export function KnowledgeView({ onOpenHit, onError }: { onOpenHit: (h: SearchHit) => void; onError: (m: string) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [kind, setKind] = useState<string>("all");
  const [done, setDone] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    setDone(false);
    if (q.trim().length < 2) return void setHits([]);
    const t = window.setTimeout(() => {
      api.globalSearch(q).then((r) => mine === seq.current && (setHits(r), setDone(true))).catch((e) => onError(errorText(e)));
    }, 200);
    return () => window.clearTimeout(t);
  }, [q, onError]);

  const kinds = [...new Set(hits.map((h) => h.kind))];
  const shown = kind === "all" ? hits : hits.filter((h) => h.kind === kind);
  return (
    <div className="kb">
      <header>
        <h1>Knowledge Base</h1>
        <p className="hint">Search your sessions, transcripts, notes, documents, diagrams, whiteboards and learning items in one place. Everything is searched on this computer.</p>
      </header>
      <input className="kb-input" type="search" autoFocus value={q} onChange={(e) => { setQ(e.target.value); setKind("all"); }} placeholder="Search everything…" aria-label="Search everything" />
      {kinds.length > 1 && (
        <div className="seg" role="group" aria-label="Filter by type">
          <button className={kind === "all" ? "active" : ""} onClick={() => setKind("all")}>All ({hits.length})</button>
          {kinds.map((k) => (
            <button key={k} className={kind === k ? "active" : ""} onClick={() => setKind(k)}>{LABEL[k] ?? k} ({hits.filter((h) => h.kind === k).length})</button>
          ))}
        </div>
      )}
      {q.trim().length < 2 && <p className="hint">Type at least two letters.</p>}
      {done && hits.length === 0 && <p className="hint">Nothing found for “{q.trim()}”.</p>}
      <ul className="kb-results">
        {shown.map((h) => (
          <li key={`${h.kind}${h.id}${h.title}`}>
            <button onClick={() => onOpenHit(h)}>
              <span className="search-kind">{LABEL[h.kind]?.replace(/s$/, "") ?? h.kind}</span>
              <strong>{h.title}</strong>
              {h.snippet && <span className="search-snip kb-snip">{h.snippet}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
