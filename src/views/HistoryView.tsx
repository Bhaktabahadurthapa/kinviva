import { useEffect, useState } from "react";
import { DecisionsDialog } from "../components/tools/DecisionsDialog";
import { TranscriptView } from "../components/TranscriptView";
import { api, errorText } from "../lib/api";
import { chooseSavePath, FORMAT_LABEL, safeName, type NotesFormat } from "../lib/download";
import type { MeetingDetail, MeetingSummary } from "../lib/types";

const fmtDate = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const dur = (m: MeetingSummary) => (m.ended_at ? `${Math.max(1, Math.round((m.ended_at - m.started_at) / 60000))} min` : "in progress");
const actionLabel: Record<string, string> = { explain: "Plain-English meaning", suggest: "Suggested reply", recap: "Recap", ask: "Answer" };

export function HistoryView({ onError, onOpenLive, refreshKey, initialSearch }: { onError: (m: string) => void; onOpenLive: () => void; refreshKey: number; initialSearch?: string }) {
  const [search, setSearch] = useState(initialSearch ?? "");
  useEffect(() => setSearch(initialSearch ?? ""), [initialSearch]);
  const [list, setList] = useState<MeetingSummary[]>([]);
  const [sel, setSel] = useState<MeetingDetail | null>(null);
  const [title, setTitle] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [dec, setDec] = useState(false);
  const [view, setView] = useState<"sessions" | "trash">("sessions");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [trashCount, setTrashCount] = useState(0);
  const [ask, setAsk] = useState<{ ids: string[]; all: boolean } | null>(null);
  const [linked, setLinked] = useState(false);
  const [undo, setUndo] = useState<string[] | null>(null);
  const inTrash = view === "trash";

  const load = () => {
    (inTrash ? api.listTrash() : api.listMeetings(search)).then((l) => { setList(l); setChecked(new Set()); }).catch((e) => onError(errorText(e)));
    api.listTrash().then((t) => setTrashCount(t.length)).catch(() => {});
  };
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [search, refreshKey, view]);

  const open = async (id: string) => {
    try {
      const d = await api.getMeeting(id);
      setSel(d);
      setTitle(d.meeting.title);
      setMsg(null);
    } catch (e) {
      onError(errorText(e));
    }
  };

  const trash = async (ids: string[]) => {
    try {
      await api.trashMeetings(ids);
      setSel(null);
      setUndo(ids);
      load();
    } catch (e) {
      onError(errorText(e));
    }
  };
  const restore = async (ids: string[]) => {
    try {
      await api.restoreMeetings(ids);
      setSel(null);
      setUndo(null);
      load();
    } catch (e) {
      onError(errorText(e));
    }
  };
  const purge = async () => {
    if (!ask) return;
    try {
      const n = ask.all ? await api.emptyTrash(linked) : await api.purgeMeetings(ask.ids, linked);
      setMsg(`${n} session${n === 1 ? "" : "s"} deleted permanently.`);
      setAsk(null);
      setLinked(false);
      setSel(null);
      load();
    } catch (e) {
      onError(errorText(e));
    }
  };

  const doExport = async (format: NotesFormat) => {
    if (!sel) return;
    const path = await chooseSavePath(safeName(sel.meeting.title, "meeting"), format);
    if (!path) return;
    try {
      await api.exportMeeting(sel.meeting.id, format, path);
      setMsg(`Exported to ${path}`);
    } catch (e) {
      onError(errorText(e));
    }
  };

  return (
    <div className="history">
      <aside className="history-list">
        <div className="seg history-view" role="tablist" aria-label="Sessions or Trash">
          <button role="tab" aria-selected={!inTrash} className={!inTrash ? "active" : ""} onClick={() => { setView("sessions"); setSel(null); }}>Sessions</button>
          <button role="tab" aria-selected={inTrash} className={inTrash ? "active" : ""} onClick={() => { setView("trash"); setSel(null); }}>Trash{trashCount ? ` (${trashCount})` : ""}</button>
        </div>
        {list.length > 0 && (
          <div className="history-bulk">
            <label className="check"><input type="checkbox" checked={checked.size === list.length} onChange={(e) => setChecked(e.target.checked ? new Set(list.map((m) => m.id)) : new Set())} /> {checked.size ? `${checked.size} selected` : "Select all"}</label>
            {checked.size > 0 && !inTrash && <button className="btn btn-sm btn-danger" onClick={() => void trash([...checked])}>Move to Trash</button>}
            {checked.size > 0 && inTrash && <button className="btn btn-sm" onClick={() => void restore([...checked])}>Restore</button>}
            {checked.size > 0 && inTrash && <button className="btn btn-sm btn-danger" onClick={() => setAsk({ ids: [...checked], all: false })}>Delete permanently</button>}
            {inTrash && checked.size === 0 && <button className="btn btn-sm btn-danger" onClick={() => setAsk({ ids: list.map((m) => m.id), all: true })}>Empty Trash</button>}
          </div>
        )}
        <div className="history-tools">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search titles, notes, transcripts" aria-label="Search meetings" />
          <button
            className="btn btn-ghost btn-sm"
            title="Adds a sample meeting marked DEMO"
            onClick={async () => {
              const id = await api.createDemoMeeting();
              await load();
              open(id);
            }}
          >
            + Demo
          </button>
        </div>
        {list.length === 0 && <p className="empty">{inTrash ? "The Trash is empty." : "No saved meetings yet."}</p>}
        {inTrash && list.length > 0 && <p className="hint">Sessions here are hidden everywhere. Restore them, or delete them permanently to erase their transcript, notes and saved audio.</p>}
        <ul>
          {list.map((m) => (
            <li key={m.id} className={sel?.meeting.id === m.id ? "active" : ""}>
              <input type="checkbox" className="history-check" aria-label={`Select ${m.title}`} checked={checked.has(m.id)} onChange={(e) => setChecked((c) => { const n = new Set(c); if (e.target.checked) n.add(m.id); else n.delete(m.id); return n; })} />
              <button onClick={() => open(m.id)}>
                <span className="t">
                  {m.is_demo && <span className="tag-demo">DEMO</span>} {m.title}
                </span>
                <span className="s">
                  {fmtDate(m.started_at)} · {dur(m)} · {m.segment_count} lines
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <section className="history-detail">
        {!sel ? (
          <p className="empty">Select a meeting to review it.</p>
        ) : (
          <>
            <header className="detail-head">
              <input
                className="title-edit"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => title !== sel.meeting.title && api.renameMeeting(sel.meeting.id, title).then(load).catch((e) => onError(errorText(e)))}
                aria-label="Meeting title"
              />
              <div className="row">
                <span className="hint">Download notes:</span>
                {(["md", "docx", "txt"] as NotesFormat[]).map((f) => (
                  <button key={f} className="btn btn-sm" onClick={() => doExport(f)}>{FORMAT_LABEL[f]}</button>
                ))}
                <button className="btn btn-sm" onClick={() => setDec(true)} title="Decisions and action items from this session">Decisions &amp; actions</button>
                <button
                  className="btn btn-sm"
                  onClick={() => api.loadMeetingContext(sel.meeting.id).then(onOpenLive).catch((e) => onError(errorText(e)))}
                  title="Use this transcript with Explain, Suggest reply, Recap and Ask"
                >
                  Open in assistant
                </button>
                {!inTrash && <button className="btn btn-sm btn-danger" onClick={() => void trash([sel.meeting.id])}>Move to Trash</button>}
                {inTrash && <button className="btn btn-sm" onClick={() => void restore([sel.meeting.id])}>Restore</button>}
                {inTrash && <button className="btn btn-sm btn-danger" onClick={() => setAsk({ ids: [sel.meeting.id], all: false })}>Delete permanently</button>}
              </div>
            </header>
            {sel.meeting.is_demo && <div className="banner banner-demo">DEMO DATA — generated sample, not a real meeting.</div>}
            {msg && <div className="banner banner-ok">{msg}</div>}
            <p className="meta">
              {fmtDate(sel.meeting.started_at)} · {dur(sel.meeting)}
            </p>
            {sel.notes && (
              <div className="detail-notes">
                <h3>Notes</h3>
                <p>{sel.notes}</p>
              </div>
            )}
            <h3>Transcript</h3>
            <TranscriptView transcript={{ finals: sel.segments, partials: {} }} emptyHint="No speech was transcribed." />
            {sel.ai_messages.filter((a) => a.status === "done").length > 0 && (
              <>
                <h3>Kinviva assistance</h3>
                {sel.ai_messages
                  .filter((a) => a.status === "done")
                  .map((a) => (
                    <div key={a.id} className="ai-history">
                      <strong>{actionLabel[a.action] ?? a.action}</strong> <span className="meta">· {a.model}</span>
                      {a.question && <div className="panel-q">Q: {a.question}</div>}
                      <p>{a.response}</p>
                    </div>
                  ))}
              </>
            )}
          </>
        )}
      </section>
      {dec && sel && <DecisionsDialog meetingId={sel.meeting.id} onClose={() => setDec(false)} onError={onError} onSaved={() => {}} />}
      {undo && !inTrash && (
        <div className="undo-toast" role="status">
          Moved {undo.length} session{undo.length === 1 ? "" : "s"} to the Trash.
          <button className="btn btn-sm" onClick={() => void restore(undo)}>Undo</button>
          <button className="btn btn-ghost btn-sm" aria-label="Dismiss" onClick={() => setUndo(null)}>✕</button>
        </div>
      )}
      {ask && (
        <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setAsk(null)}>
          <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="purge-title" style={{ textAlign: "left" }}>
            <h2 id="purge-title" style={{ textAlign: "center" }}>{ask.all ? "Empty the Trash?" : `Delete ${ask.ids.length} session${ask.ids.length === 1 ? "" : "s"} permanently?`}</h2>
            <p className="dialog-sub" style={{ textAlign: "center" }}>This erases the transcript, answers and any saved audio from this computer. It cannot be undone.</p>
            <label className="check" style={{ margin: "0 0 16px" }}><input type="checkbox" checked={linked} onChange={(e) => setLinked(e.target.checked)} /> Also delete the notes, diagrams and boards saved from {ask.ids.length === 1 && !ask.all ? "this session" : "these sessions"}</label>
            <div className="dialog-actions">
              <button className="btn" onClick={() => setAsk(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => void purge()}>Delete permanently</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
