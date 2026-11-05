import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorText } from "../lib/api";
import { newId, type AppRecord } from "../lib/platform";

const when = (ms?: number) => (ms ? new Date(ms).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "");

/** All notes: list on the left, editor on the right, saved automatically. */
export function NotesView({ onError, refreshKey, onChanged }: { onError: (m: string) => void; refreshKey: number; onChanged: () => void }) {
  const [list, setList] = useState<AppRecord[]>([]);
  const [search, setSearch] = useState("");
  const [sel, setSel] = useState<AppRecord | null>(null);
  const [state, setState] = useState<"saved" | "saving" | "">("");
  const timer = useRef<number>();
  const dirty = useRef(false);

  const load = useCallback(() => api.recordList("note", search).then(setList).catch((e) => onError(errorText(e))), [search, onError]);
  useEffect(() => {
    const t = window.setTimeout(() => void load(), 150);
    return () => window.clearTimeout(t);
  }, [load, refreshKey]);

  const persist = useCallback(
    async (n: AppRecord) => {
      setState("saving");
      try {
        const saved = await api.recordSave(n);
        dirty.current = false;
        setState("saved");
        setList((l) => [saved, ...l.filter((x) => x.id !== saved.id)]);
        onChanged();
      } catch (e) {
        onError(errorText(e));
      }
    },
    [onError, onChanged],
  );

  const edit = (patch: Partial<AppRecord>) => {
    if (!sel) return;
    const next = { ...sel, ...patch };
    setSel(next);
    dirty.current = true;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void persist(next), 700);
  };

  const flush = () => {
    window.clearTimeout(timer.current);
    if (sel && dirty.current) void persist(sel);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const create = () => {
    flush();
    const n: AppRecord = { id: newId(), kind: "note", title: "Untitled note", body: "" };
    setSel(n);
    setState("");
    void persist(n);
  };

  const remove = async () => {
    if (!sel) return;
    try {
      await api.recordDelete(sel.id);
      setList((l) => l.filter((x) => x.id !== sel.id));
      setSel(null);
      onChanged();
    } catch (e) {
      onError(errorText(e));
    }
  };

  return (
    <div className="notes">
      <aside className="notes-list">
        <div className="notes-list-head">
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search notes" aria-label="Search notes" />
          <button className="btn btn-primary btn-sm" onClick={create}>New note</button>
        </div>
        {list.length === 0 ? (
          <p className="hint">{search ? "No notes match." : "No notes yet. Write one here, or press Save to notes under any answer."}</p>
        ) : (
          <ul>
            {list.map((n) => (
              <li key={n.id} className={sel?.id === n.id ? "active" : ""}>
                <button onClick={() => { flush(); setSel(n); setState(""); }}>
                  <strong>{n.title || "Untitled"}</strong>
                  <span>{when(n.updated_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
      <section className="notes-editor">
        {sel ? (
          <>
            <div className="notes-editor-head">
              <input className="notes-title" value={sel.title} onChange={(e) => edit({ title: e.target.value })} onBlur={flush} aria-label="Note title" maxLength={200} />
              <span className="hint" role="status">{state === "saving" ? "Saving…" : state === "saved" ? "Saved" : ""}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => void remove()}>Delete</button>
            </div>
            <textarea value={sel.body} onChange={(e) => edit({ body: e.target.value })} onBlur={flush} placeholder="Write your note…" aria-label="Note text" />
            {sel.meeting_id && <p className="hint">Linked to a session. Open it from Session history.</p>}
          </>
        ) : (
          <div className="notes-empty"><h3>Select or create a note</h3><p>Notes stay on this computer. Search finds them from the top bar.</p></div>
        )}
      </section>
    </div>
  );
}
