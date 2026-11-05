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

  const load = () => api.listMeetings(search).then(setList).catch((e) => onError(errorText(e)));
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [search, refreshKey]);

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
        {list.length === 0 && <p className="empty">No saved meetings yet.</p>}
        <ul>
          {list.map((m) => (
            <li key={m.id} className={sel?.meeting.id === m.id ? "active" : ""}>
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
                <button
                  className="btn btn-sm btn-danger"
                  onClick={async () => {
                    if (!confirm(`Delete “${sel.meeting.title}” permanently?`)) return;
                    try {
                      await api.deleteMeeting(sel.meeting.id);
                      setSel(null);
                      load();
                    } catch (e) {
                      onError(errorText(e));
                    }
                  }}
                >
                  Delete
                </button>
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
                <h3>MeetingLens assistance</h3>
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
    </div>
  );
}
