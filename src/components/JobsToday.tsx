import { useState } from "react";
import { ageLabel, scoreLabel, type Digest, type Job, type Match } from "../lib/jobs";

interface Row {
  job: Job;
  match: Match;
}

/** This morning's new jobs, best match first. Nothing happens to a job until you approve it. */
export function JobsToday({ digest, rows, hasResume, running, busyId, scheduleOn, onRun, onApprove, onSkip, onOpen }: {
  digest: Digest | null;
  rows: Row[];
  hasResume: boolean;
  running: boolean;
  busyId: string | null;
  scheduleOn: boolean;
  onRun: () => void;
  onApprove: (job: Job, score: number) => void;
  onSkip: (id: string) => void;
  onOpen: (url: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <section className="dash-card jb-today" aria-label="Morning search">
      <header>
        <h2>Today's new jobs</h2>
      </header>
      <p className="hint">
        {digest
          ? `Searched ${new Date(digest.at_ms).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}. ${digest.jobs.length} new job${digest.jobs.length === 1 ? "" : "s"} out of ${digest.total} found.`
          : "No morning search has run yet."}{" "}
        {scheduleOn ? "It runs by itself each morning while Kinviva is open." : "Turn on the morning search in Settings → Job applications."}
      </p>
      <div className="disc-row">
        <button className="btn btn-primary" onClick={onRun} disabled={running}>{running ? "Searching…" : "Search now with my saved choices"}</button>
        <span className="hint">Uses the choices on Find jobs. Nothing is applied or sent.</span>
      </div>
      {!hasResume && <p className="hint">Add your resume under My resume to see match scores and to approve jobs.</p>}
      {digest && rows.length === 0 && <p className="hint">Nothing waiting. Everything from today's search is approved or skipped.</p>}
      <div className="jb-list">
        {rows.map(({ job, match }) => (
          <div key={job.id} className={`dash-card jb-job ${openId === job.id ? "open" : ""}`}>
            <button className="jb-head" onClick={() => setOpenId(openId === job.id ? null : job.id)} aria-expanded={openId === job.id}>
              <span className={`jb-score s${match.score >= 75 ? "hi" : match.score >= 50 ? "mid" : "lo"}`} title={`${scoreLabel(match.score)} (estimate)`}>{hasResume ? match.score : "–"}</span>
              <span className="jb-main">
                <strong>{job.title}</strong>
                <span className="hint">{[job.company, job.location, job.remote ? "Remote" : "", ageLabel(job.posted_ms), job.source].filter(Boolean).join(" · ")}</span>
              </span>
            </button>
            {openId === job.id && (
              <div className="jb-detail">
                {hasResume && match.missing.length > 0 && (
                  <>
                    <p className="hint">Not in your resume. Add them only if they are true for you:</p>
                    <div className="disc-chips">{match.missing.map((m) => <span key={m} className="chip jb-miss">{m}</span>)}</div>
                  </>
                )}
                <pre className="jb-desc">{job.description}</pre>
              </div>
            )}
            <div className="disc-row jb-actions">
              <button className="btn btn-primary btn-sm" disabled={!hasResume || busyId !== null} onClick={() => onApprove(job, match.score)}>
                {busyId === job.id ? "Preparing resume and letter…" : "Approve: prepare my resume"}
              </button>
              <button className="btn btn-sm" onClick={() => onSkip(job.id)} disabled={busyId === job.id}>Skip</button>
              <button className="btn btn-ghost btn-sm" onClick={() => onOpen(job.url)}>Open posting</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
