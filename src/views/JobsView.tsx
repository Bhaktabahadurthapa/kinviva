import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errorText } from "../lib/api";
import { ResumeFormat } from "../components/ResumeFormat";
import { chooseSavePath, safeName } from "../lib/download";
import { parseResume, type TemplateId } from "../lib/resume";
import {
  APPS_KEY, CATEGORIES, LAST_KEY, PREFS_KEY, RESUME_KEY, SEEN_KEY, STATUSES, STATUS_LABEL, ageLabel, agentDue, matchJob, mergeSeen, newClaims, newJobIds, parseApps, parseBoards, parsePrefs, parseSeen,
  reminderLabel, reminders, scoreLabel,
  type Application, type Job, type JobsReport, type Status,
} from "../lib/jobs";

type Section = "resume" | "find" | "tracker";
const SECTIONS: [Section, string][] = [["resume", "My resume"], ["find", "Find jobs"], ["tracker", "Tracker"]];

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: it still works until the window closes */
  }
}

/** Find jobs, see how well your resume fits, tailor it to one job from what it already says, and track where you applied. */
export default function JobsView({ onError }: { onError: (m: string) => void }) {
  const [section, setSection] = useState<Section>("resume");
  const [resume, setResume] = useState(() => read(RESUME_KEY) ?? "");
  const [apps, setApps] = useState<Application[]>(() => parseApps(read(APPS_KEY)));
  const [prefs, setPrefs] = useState(() => parsePrefs(read(PREFS_KEY)));
  const [report, setReport] = useState<JobsReport | null>(null);
  const [searching, setSearching] = useState(false);
  const [sort, setSort] = useState<"match" | "new">("match");
  const [openId, setOpenId] = useState<string | null>(null);
  const [tailor, setTailor] = useState<{ jobId: string; text: string; changes: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const reqRef = useRef<string | null>(null);

  useEffect(() => write(RESUME_KEY, resume), [resume]);
  useEffect(() => write(APPS_KEY, JSON.stringify(apps)), [apps]);
  useEffect(() => write(PREFS_KEY, JSON.stringify(prefs)), [prefs]);

  const fail = (e: unknown) => onError(errorText(e));
  const scored = useMemo(
    () => (report?.jobs ?? []).map((j) => ({ job: j, match: matchJob(resume, j) })).sort((a, b) => (sort === "match" ? b.match.score - a.match.score : (b.job.posted_ms ?? 0) - (a.job.posted_ms ?? 0))),
    [report, resume, sort],
  );

  const pickFile = async () => {
    try {
      const picked = await open({ multiple: false, filters: [{ name: "Resume", extensions: ["pdf", "docx", "txt", "md"] }] });
      if (typeof picked !== "string") return;
      setResume(await api.resumeRead(picked));
      setNote("Read from your file. Check the text below and fix anything the reader got wrong, especially names and dates.");
    } catch (e) {
      fail(e);
    }
  };

  const search = useCallback(async () => {
    setSearching(true);
    setReport(null);
    setOpenId(null);
    try {
      const r = await api.jobsSearch({ categories: prefs.categories, keywords: prefs.keywords, remote_only: prefs.remoteOnly, boards: parseBoards(prefs.boards) });
      const seen = parseSeen(read(SEEN_KEY));
      const last = read(LAST_KEY);
      setFresh(newJobIds(r.jobs, seen, last !== null));
      write(SEEN_KEY, JSON.stringify(mergeSeen(seen, r.jobs)));
      write(LAST_KEY, String(Date.now()));
      setReport(r);
    } catch (e) {
      onError(errorText(e));
    } finally {
      setSearching(false);
    }
  }, [prefs, onError]);

  // The job agent: search again by itself when it is on and the last search is old. Only while Kinviva is open.
  const agentRan = useRef(false);
  useEffect(() => {
    if (agentRan.current) return;
    agentRan.current = true;
    const last = Number(read(LAST_KEY));
    if (agentDue(prefs.agent, last > 0 ? last : null) && (prefs.categories.length > 0 || prefs.keywords.trim() || prefs.boards.trim())) {
      setSection("find");
      void search();
    }
  }, [prefs, search]);

  const upsert = (job: Job, patch: Partial<Application>, score: number) =>
    setApps((all) => {
      const old = all.find((a) => a.id === job.id);
      const next: Application = { id: job.id, title: job.title, company: job.company, url: job.url, status: "saved", score, notes: "", updated: Date.now(), ...old, ...patch };
      return [next, ...all.filter((a) => a.id !== job.id)];
    });

  const doTailor = async (job: Job, score: number) => {
    if (!resume.trim()) return onError("Add your resume first (My resume).");
    setBusy(true);
    setTailor(null);
    const id = crypto.randomUUID();
    reqRef.current = id;
    try {
      const [text, changes] = await api.jobsTailor(id, resume, job.title, job.company, job.description);
      setTailor({ jobId: job.id, text, changes });
      upsert(job, { status: "preparing", resume: text }, score);
    } catch (e) {
      if (errorText(e) !== "Cancelled.") fail(e);
    } finally {
      reqRef.current = null;
      setBusy(false);
    }
  };

  const exportResume = async (text: string, format: "docx" | "txt", stem: string) => {
    try {
      const path = await chooseSavePath(safeName(stem, "Resume"), format);
      if (path) setNote(`Saved ${await api.resumeExport(parseResume(text), prefs.template, format, path)}`);
    } catch (e) {
      fail(e);
    }
  };

  const [formatting, setFormatting] = useState(false);
  const [before, setBefore] = useState<string | null>(null);
  const reformat = async () => {
    if (!resume.trim()) return onError("Add your resume first.");
    setFormatting(true);
    try {
      const text = await api.resumeReformat(crypto.randomUUID(), resume);
      setBefore(resume);
      setResume(text);
      setNote("Reformatted to the US standard. Read it through: names, dates and numbers must match your original.");
    } catch (e) {
      if (errorText(e) !== "Cancelled.") fail(e);
    } finally {
      setFormatting(false);
    }
  };

  const exportLetter = async (a: Application) => {
    try {
      const path = await chooseSavePath(safeName(`${a.company} ${a.title} cover letter`, "Cover letter"), "docx");
      if (path) setNote(`Saved ${await api.letterExport(a.letter ?? "", `${a.title}, ${a.company}`, "docx", path)}`);
    } catch (e) {
      fail(e);
    }
  };

  const setStatus = (id: string, status: Status) => setApps((all) => all.map((a) => (a.id === id ? { ...a, status, updated: Date.now() } : a)));

  const due = useMemo(() => reminders(apps), [apps]);

  return (
    <div className="disc jobs">
      <header className="disc-head">
        <div>
          <h1>Jobs & Resume</h1>
          <p className="hint">Find open roles, see how well your resume fits, and tailor it to one job using only what it already says. Your resume stays on this computer. It goes to your answer engine only when you press Tailor.</p>
        </div>
      </header>
      <div className="seg" role="tablist" aria-label="Jobs sections">
        {SECTIONS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={section === id} className={section === id ? "active" : ""} onClick={() => setSection(id)}>
            {label}
            {id === "tracker" && apps.length > 0 ? ` (${apps.length})` : ""}
          </button>
        ))}
      </div>
      {note && <p className="hint" role="status">{note}</p>}

      {section === "resume" && (
        <section className="dash-card">
          <header><h2>Your core resume</h2></header>
          <p className="hint">This is the one source of truth. Every tailored version is built only from it.</p>
          <div className="disc-row">
            <button className="btn btn-primary" onClick={() => void pickFile()}>Open a resume file (PDF, Word, text)</button>
            {resume && <button className="btn btn-ghost btn-sm" onClick={() => (setResume(""), setNote(""))}>Clear</button>}
          </div>
          <textarea className="jb-text" value={resume} onChange={(e) => setResume(e.target.value)} placeholder={"Paste your resume text here, or open a file.\nPut your name first, then contact details, then headings such as SKILLS, EXPERIENCE and EDUCATION."} aria-label="Your resume" rows={18} />
          {resume.trim() && (
            <>
              <div className="disc-row">
                <button className="btn btn-primary" onClick={() => void reformat()} disabled={formatting}>{formatting ? "Reformatting…" : "Reformat to US standard"}</button>
                {before !== null && <button className="btn" onClick={() => (setResume(before), setBefore(null), setNote("Back to your original text."))}>Undo</button>}
                <button className="btn" onClick={() => void exportResume(resume, "docx", "Resume")}>Save as Word</button>
                <button className="btn" onClick={() => void exportResume(resume, "txt", "Resume")}>Save as text</button>
              </div>
              <p className="hint">Reformatting changes layout only. It sends your resume to your answer engine. The Word file uses the layout you pick below.</p>
              <ResumeFormat text={resume} template={prefs.template} onTemplate={(t: TemplateId) => setPrefs({ ...prefs, template: t })} />
            </>
          )}
        </section>
      )}

      {section === "find" && (
        <>
          <section className="dash-card">
            <header><h2>What are you looking for?</h2></header>
            <div className="disc-chips" role="group" aria-label="Categories">
              {CATEGORIES.map((c) => (
                <button key={c.id} className={`chip ${prefs.categories.includes(c.id) ? "on" : ""}`} aria-pressed={prefs.categories.includes(c.id)} onClick={() => setPrefs({ ...prefs, categories: prefs.categories.includes(c.id) ? prefs.categories.filter((x) => x !== c.id) : [...prefs.categories, c.id] })}>
                  {c.label}
                </button>
              ))}
            </div>
            <div className="disc-row">
              <input value={prefs.keywords} onChange={(e) => setPrefs({ ...prefs, keywords: e.target.value })} placeholder="Keywords, separated by commas (for example: kubernetes, platform)" aria-label="Keywords" />
              <label className="check"><input type="checkbox" checked={prefs.remoteOnly} onChange={(e) => setPrefs({ ...prefs, remoteOnly: e.target.checked })} /> Remote only</label>
            </div>
            <label className="check"><input type="checkbox" checked={prefs.agent} onChange={(e) => setPrefs({ ...prefs, agent: e.target.checked })} /> Job agent: search again by itself when I open Jobs, about every 12 hours</label>
            {prefs.agent && <p className="hint">It runs only while Kinviva is open, uses the choices above, and marks jobs that are new since your last search. It never applies for you.</p>}
            <details>
              <summary>Add company job boards (optional)</summary>
              <p className="hint">Type one per line, like <code>greenhouse:stripe</code> or <code>lever:netflix</code> or <code>ashby:linear</code>. The name is the part of the company's careers address after the site name.</p>
              <textarea className="jb-boards" value={prefs.boards} onChange={(e) => setPrefs({ ...prefs, boards: e.target.value })} rows={3} aria-label="Company boards" />
            </details>
            <div className="disc-row">
              <button className="btn btn-primary" onClick={() => void search()} disabled={searching}>{searching ? "Searching…" : "Search jobs"}</button>
              <span className="hint">Looks only at public job feeds that allow it. It does not use LinkedIn or Indeed.</span>
            </div>
            {!resume.trim() && <p className="hint">Add your resume under My resume to see a match for each job.</p>}
          </section>

          {report && (
            <>
              {report.errors.length > 0 && <p className="hint jb-errors">Some sources did not answer: {report.errors.join("; ")}.</p>}
              <div className="disc-row">
                <strong>{scored.length} job{scored.length === 1 ? "" : "s"}</strong>
                {fresh.size > 0 && <span className="chip on">{fresh.size} new since your last search</span>}
                <span className="spacer" />
                <div className="seg" aria-label="Sort">
                  <button className={sort === "match" ? "active" : ""} onClick={() => setSort("match")}>Best match</button>
                  <button className={sort === "new" ? "active" : ""} onClick={() => setSort("new")}>Newest</button>
                </div>
              </div>
              {scored.length === 0 && <p className="hint">No jobs matched. Try other categories or fewer keywords.</p>}
              <div className="jb-list">
                {scored.map(({ job, match }) => (
                  <div key={job.id} className={`dash-card jb-job ${openId === job.id ? "open" : ""}`}>
                    <button className="jb-head" onClick={() => (setOpenId(openId === job.id ? null : job.id), setTailor(null))} aria-expanded={openId === job.id}>
                      <span className={`jb-score s${match.score >= 75 ? "hi" : match.score >= 50 ? "mid" : "lo"}`} title={`${scoreLabel(match.score)} (estimate)`}>{resume.trim() ? match.score : "–"}</span>
                      <span className="jb-main">
                        <strong>{job.title}{fresh.has(job.id) && <span className="jb-new"> New</span>}</strong>
                        <span className="hint">{[job.company, job.location, job.remote ? "Remote" : "", ageLabel(job.posted_ms), job.source].filter(Boolean).join(" · ")}</span>
                      </span>
                    </button>
                    {openId === job.id && (
                      <div className="jb-detail">
                        {resume.trim() && (
                          <>
                            <p><strong>{scoreLabel(match.score)}</strong> <span className="hint">An estimate from {match.basis === "skills" ? "the skills the posting names" : "the words the posting repeats"}, not a prediction of any employer's system.</span></p>
                            {match.matched.length > 0 && <div className="disc-chips" aria-label="In your resume">{match.matched.map((m) => <span key={m} className="chip on">{m}</span>)}</div>}
                            {match.missing.length > 0 && <><p className="hint">Not in your resume. Add them only if they are true for you:</p><div className="disc-chips" aria-label="Not in your resume">{match.missing.map((m) => <span key={m} className="chip jb-miss">{m}</span>)}</div></>}
                          </>
                        )}
                        <div className="disc-row">
                          <button className="btn btn-primary" onClick={() => void doTailor(job, match.score)} disabled={busy}>{busy ? "Tailoring…" : "Tailor my resume and prepare"}</button>
                          {busy && reqRef.current && <button className="btn btn-sm" onClick={() => void api.aiCancel(reqRef.current!).catch(() => undefined)}>Cancel</button>}
                          <button className="btn" onClick={() => (upsert(job, {}, match.score), setNote("Saved to your tracker."))}>Save job</button>
                          <button className="btn" onClick={() => void api.openLink(job.url).catch(fail)}>Open the application page</button>
                        </div>
                        {tailor?.jobId === job.id && <TailorPanel job={job} master={resume} template={prefs.template} onTemplate={(tp) => setPrefs({ ...prefs, template: tp })} t={tailor} onChange={(text) => (setTailor({ ...tailor, text }), upsert(job, { resume: text }, match.score))} onExport={exportResume} onApplied={() => (setStatus(job.id, "applied"), setNote("Marked as applied in your tracker."))} onLetter={(letter) => upsert(job, { letter }, match.score)} onNote={setNote} onError={fail} />}
                        <h3>Job description</h3>
                        <pre className="jb-desc">{job.description}</pre>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {section === "tracker" && (
        <>
        {due.length > 0 && (
          <section className="dash-card jb-due" aria-label="Reminders">
            <header><h2>Coming up</h2></header>
            <ul>{due.map((r) => <li key={`${r.id}-${r.kind}`} className={r.inDays < 0 ? "late" : ""}><strong>{r.title}</strong> at {r.company || "this company"}: {reminderLabel(r)} <span className="hint">({r.day})</span></li>)}</ul>
          </section>
        )}
        <section className="jb-board">
          {apps.length === 0 && <p className="hint">Nothing here yet. Save a job or tailor a resume and it will appear here.</p>}
          {STATUSES.map((st) => {
            const col = apps.filter((a) => a.status === st);
            return col.length || apps.length ? (
              <div key={st} className="jb-col">
                <h3>{STATUS_LABEL[st]} <span className="hint">{col.length}</span></h3>
                {col.map((a) => (
                  <div key={a.id} className="dash-card jb-card">
                    <strong>{a.title}</strong>
                    <span className="hint">{a.company}{a.score ? ` · match ${a.score}` : ""}</span>
                    <select value={a.status} onChange={(e) => setStatus(a.id, e.target.value as Status)} aria-label={`Status of ${a.title}`}>
                      {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                    </select>
                    <label className="jb-date">Interview <input type="date" value={a.interview ?? ""} onChange={(e) => setApps((all) => all.map((x) => (x.id === a.id ? { ...x, interview: e.target.value || undefined } : x)))} /></label>
                    <label className="jb-date">Follow up <input type="date" value={a.followUp ?? ""} onChange={(e) => setApps((all) => all.map((x) => (x.id === a.id ? { ...x, followUp: e.target.value || undefined } : x)))} /></label>
                    <input value={a.notes} placeholder="Notes" aria-label={`Notes for ${a.title}`} onChange={(e) => setApps((all) => all.map((x) => (x.id === a.id ? { ...x, notes: e.target.value } : x)))} />
                    <div className="disc-row">
                      {a.url && <button className="btn btn-sm" onClick={() => void api.openLink(a.url).catch(fail)}>Open page</button>}
                      {a.resume && <button className="btn btn-sm" onClick={() => void exportResume(a.resume!, "docx", `${a.title} resume`)}>Resume (Word)</button>}
                      {a.letter && <button className="btn btn-sm" onClick={() => void exportLetter(a)}>Letter (Word)</button>}
                      <button className="btn btn-ghost btn-sm" onClick={() => setApps((all) => all.filter((x) => x.id !== a.id))}>Remove</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null;
          })}
        </section>
        </>
      )}
    </div>
  );
}

function TailorPanel({ job, master, template, onTemplate, t, onChange, onExport, onApplied, onLetter, onNote, onError }: { job: Job; master: string; template: TemplateId; onTemplate: (t: TemplateId) => void; t: { text: string; changes: string[] }; onChange: (s: string) => void; onExport: (text: string, f: "docx" | "txt", stem: string) => void; onApplied: () => void; onLetter: (s: string) => void; onNote: (s: string) => void; onError: (e: unknown) => void }) {
  const [letter, setLetter] = useState("");
  const [writing, setWriting] = useState(false);
  const claims = newClaims(master, t.text);
  const after = matchJob(t.text, job);
  const before = matchJob(master, job);
  const writeLetter = async () => {
    setWriting(true);
    try {
      const text = await api.jobsCoverLetter(crypto.randomUUID(), t.text, job.title, job.company, job.description);
      setLetter(text);
      onLetter(text);
    } catch (e) {
      if (errorText(e) !== "Cancelled.") onError(e);
    } finally {
      setWriting(false);
    }
  };
  const saveLetter = async (format: "docx" | "txt") => {
    try {
      const path = await chooseSavePath(safeName(`${job.company} ${job.title} cover letter`, "Cover letter"), format);
      if (path) onNote(`Saved ${await api.letterExport(letter, `${job.title}, ${job.company}`, format, path)}`);
    } catch (e) {
      onError(e);
    }
  };
  const letterClaims = letter ? newClaims(master, letter) : { skills: [], numbers: [] };
  return (
    <div className="jb-tailor">
      <h3>Your resume for this job</h3>
      <p className="hint">Match estimate: {before.score} before, {after.score} after. Read it all and fix anything wrong before you send it.</p>
      {(claims.skills.length > 0 || claims.numbers.length > 0) && (
        <div className="banner banner-bad" role="alert">
          This version mentions things your own resume does not: {[...claims.skills, ...claims.numbers].join(", ")}. Remove them unless they are true.
        </div>
      )}
      {t.changes.length > 0 && <ul className="jb-changes">{t.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>}
      <textarea className="jb-text" value={t.text} onChange={(e) => onChange(e.target.value)} rows={16} aria-label="Tailored resume" />
      <details>
        <summary>Layout and preview (US format)</summary>
        <ResumeFormat text={t.text} template={template} onTemplate={onTemplate} />
      </details>
      <div className="disc-row">
        <button className="btn btn-primary" onClick={() => onExport(t.text, "docx", `${job.company} ${job.title} resume`)}>Save as Word</button>
        <button className="btn" onClick={() => onExport(t.text, "txt", `${job.company} ${job.title} resume`)}>Save as text</button>
        <button className="btn" onClick={() => void navigator.clipboard?.writeText(t.text).catch(() => undefined)}>Copy</button>
        <button className="btn" onClick={() => void api.openLink(job.url).catch(() => undefined)}>Open the application page</button>
        <button className="btn btn-ghost" onClick={onApplied}>I applied</button>
      </div>
      <div className="disc-row">
        <button className="btn" onClick={() => void writeLetter()} disabled={writing}>{writing ? "Writing…" : letter ? "Write the letter again" : "Write a cover letter"}</button>
      </div>
      {letter && (
        <>
          {(letterClaims.skills.length > 0 || letterClaims.numbers.length > 0) && <div className="banner banner-bad" role="alert">The letter mentions things your resume does not: {[...letterClaims.skills, ...letterClaims.numbers].join(", ")}. Remove them unless they are true.</div>}
          <textarea className="jb-text" value={letter} onChange={(e) => (setLetter(e.target.value), onLetter(e.target.value))} rows={12} aria-label="Cover letter" />
          <div className="disc-row">
            <button className="btn btn-primary" onClick={() => void saveLetter("docx")}>Save letter as Word</button>
            <button className="btn" onClick={() => void saveLetter("txt")}>Save as text</button>
            <button className="btn" onClick={() => void navigator.clipboard?.writeText(letter).catch(() => undefined)}>Copy</button>
          </div>
        </>
      )}
      <p className="hint">Kinviva does not send applications for you. You press Submit on the employer's page. That keeps you in control of what is sent.</p>
    </div>
  );
}
