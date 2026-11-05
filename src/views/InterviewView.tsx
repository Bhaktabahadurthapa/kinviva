import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { api, errorText } from "../lib/api";
import { initialInterview, interviewReducer, isBusy, latestQuestion, type Slot } from "../lib/interview";
import { ActionBar } from "../components/ActionBar";
import { ManualAnswers } from "../components/ManualAnswers";
import { Splitter } from "../components/Splitter";
import { INTERVIEW_SPLIT_KEY, loadSplit, saveSplit } from "../lib/split";
import { ScreenAssist } from "../components/ScreenAssist";
import { NotesDownload } from "../components/NotesDownload";
import { chooseSavePath, type NotesFormat } from "../lib/download";
import type { InterviewCategory, InterviewEvent, InterviewLanguage, InterviewMode, InterviewRole, InterviewStyle, SkillInfo } from "../lib/types";
import type { LiveState } from "../lib/liveReducer";

const CATEGORIES: [InterviewCategory, string][] = [
  ["cloud_devops", "Cloud / DevOps"],
  ["system_design", "System design"],
  ["ai_engineering", "AI engineering"],
  ["coding", "Coding"],
];
const ROLES: [InterviewRole, string, InterviewCategory][] = [
  ["cloud_devops_engineer", "Cloud / DevOps engineer", "cloud_devops"],
  ["backend_engineer", "Backend engineer", "system_design"],
  ["ai_engineer", "AI engineer", "ai_engineering"],
  ["software_engineer", "Software engineer", "coding"],
];
const STYLES: [InterviewStyle, string, string][] = [
  ["simple", "Simple", "Short, clear, everyday words"],
  ["professional", "Professional", "Natural and confident"],
  ["technical", "Technical", "More engineering depth"],
  ["star", "STAR", "Situation, Task, Action, Result for behavioral questions; uses only your own notes"],
];
const LANGUAGES: [InterviewLanguage, string][] = [
  ["python", "Python"],
  ["java", "Java"],
  ["cpp", "C++"],
];
const HINTS: Record<InterviewCategory, string> = {
  cloud_devops: "A deployment keeps failing health checks and rolls back. How do you find the cause?",
  system_design: "Design a rate limiter for a public API.",
  ai_engineering: "How would you reduce hallucinations in a document Q&A assistant?",
  coding: "Return the indices of two numbers in an array that add up to a target.",
};

function Lines({ text }: { text: string }) {
  return (
    <>
      {text.split(/\n+/).filter(Boolean).map((l, i) => (
        <p key={i}>{l}</p>
      ))}
    </>
  );
}

function Section({ title, tone, children }: { title: string; tone?: "say" | "warn"; children: React.ReactNode }) {
  return (
    <section className={`iv-card ${tone ? `iv-${tone}` : ""}`}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Result({ slot, stale, onModelAnswer }: { slot: Slot; stale: boolean; onModelAnswer?: () => void }) {
  const r = slot.result;
  if (slot.status === "starting" || slot.status === "streaming")
    return <p className="iv-wait" role="status">Writing the answer… {slot.received > 0 && <span>{slot.received} characters</span>}</p>;
  if (slot.status === "error") return <div className="banner banner-bad" role="alert">{slot.error}</div>;
  if (slot.status === "cancelled") return <p className="iv-wait">Cancelled.</p>;
  if (slot.status !== "done") return null;
  return (
    <div className={stale ? "iv-results is-stale" : "iv-results"}>
      {stale && <div className="banner">You changed the inputs after this result was made. Ask again to refresh it.</div>}
      {!r && slot.fallbackText && (
        <>
          {slot.error && <div className="banner">{slot.error}</div>}
          <Section title="Answer (plain text)"><div className="iv-text"><Lines text={slot.fallbackText} /></div></Section>
        </>
      )}
      {r?.kind === "question" && (
        <Section title="Mock question" tone="say">
          <div className="iv-say"><p>{r.question}</p></div>
          {r.tests && <p className="iv-disclaimer">Tests: {r.tests}</p>}
          <p className="iv-disclaimer">Write your answer on the left, then press Check my answer.</p>
        </Section>
      )}
      {r?.kind === "answer" && (
        <>
          <Section title="Say it" tone="say">
            <div className="iv-say"><Lines text={r.say_it} /></div>
          </Section>
          <Section title="Understand it">
            <div className="iv-text"><Lines text={r.understand_it} /></div>
            {r.code && <pre className="iv-code"><code>{r.code}</code></pre>}
          </Section>
          {r.tradeoffs.length > 0 && (
            <Section title="Tradeoffs and assumptions">
              <ul>{r.tradeoffs.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </Section>
          )}
          {(r.hard_words?.length ?? 0) > 0 && (
            <Section title="Hard words, made simple">
              <ul className="iv-words">{r.hard_words!.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </Section>
          )}
          {r.follow_up && <Section title="Likely follow-up question"><p>{r.follow_up}</p></Section>}
        </>
      )}
      {r?.kind === "feedback" && (
        <>
          <p className="iv-disclaimer">
            Coaching feedback{r.coaching_score != null && <> · practice score <b>{r.coaching_score}/10</b></>}. This is not a calibrated hiring assessment.
          </p>
          <Section title="Correctness"><div className="iv-text"><Lines text={r.correctness} /></div></Section>
          {r.missing_points.length > 0 && (
            <Section title="Missing points" tone="warn">
              <ul>{r.missing_points.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </Section>
          )}
          {r.structure && <Section title="Structure"><p>{r.structure}</p></Section>}
          {r.clarity && <Section title="Clarity"><p>{r.clarity}</p></Section>}
          {r.improved_say_it && <Section title="A stronger way to say it" tone="say"><div className="iv-say"><Lines text={r.improved_say_it} /></div></Section>}
          {r.follow_up && <Section title="Likely follow-up question"><p>{r.follow_up}</p></Section>}
          {onModelAnswer && <button className="btn btn-sm" onClick={onModelAnswer}>Show the model answer</button>}
        </>
      )}
    </div>
  );
}

const IV_DEFAULT = 40;

export function InterviewView({ live, onError, since, onNewSession }: { live: LiveState; onError: (m: string) => void; since: number; onNewSession: () => void }) {
  const [savedCount, setSavedCount] = useState(0);
  const [allCount, setAllCount] = useState(0);
  const [noteMsg, setNoteMsg] = useState<string | null>(null);
  const refreshCounts = () => {
    api.interviewSavedCount(since).then(setSavedCount).catch(() => {});
    api.interviewSavedCount(null).then(setAllCount).catch(() => {});
  };
  useEffect(refreshCounts, [since]);
  useEffect(() => {
    const sub = listen("interview-saved", refreshCounts);
    return () => void sub.then((un) => un());
  }, [since]);
  const download = async (f: NotesFormat, scope: "session" | "all") => {
    const path = await chooseSavePath(scope === "session" ? "interview-practice-notes" : "interview-practice-all", f);
    if (!path) return;
    try {
      await api.exportInterview(f, path, scope === "session" ? since : null);
      setNoteMsg(`Saved to ${path}`);
    } catch (e) {
      onError(errorText(e));
    }
  };
  const [split, setSplitState] = useState(() => loadSplit(INTERVIEW_SPLIT_KEY, IV_DEFAULT));
  const setSplit = (v: number) => {
    setSplitState(v);
    saveSplit(v, INTERVIEW_SPLIT_KEY);
  };
  const grid = useRef<HTMLDivElement>(null);
  const [category, setCategory] = useState<InterviewCategory>("cloud_devops");
  const [language, setLanguage] = useState<InterviewLanguage>("python");
  const [mode, setMode] = useState<InterviewMode>("explain");
  const [role, setRole] = useState<InterviewRole>("cloud_devops_engineer");
  const [style, setStyle] = useState<InterviewStyle>("simple");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [state, dispatch] = useReducer(interviewReducer, initialInterview);
  const [skills, setSkills] = useState<SkillInfo[]>([]);

  useEffect(() => {
    api.interviewSkills().then(setSkills).catch((e) => onError(errorText(e)));
    const sub = listen<InterviewEvent>("interview-event", (e) => dispatch({ type: "event", event: e.payload }));
    return () => void sub.then((un) => un());
  }, []);

  const busy = Object.values(state.slots).some(isBusy);
  // A generated question does not depend on the question box, so it is never "stale" for that reason.
  const inputKey = (m: InterviewMode) =>
    JSON.stringify([category, role, m === "explain" ? style : null, m, category === "coding" ? language : null, m === "question" ? "" : question.trim(), m === "practice" ? answer.trim() : ""]);
  // In mock practice the feedback replaces the generated question once you submit your answer.
  const feedbackShown = mode === "question" && state.slots.practice.status !== "idle" && state.slots.practice.inputKey === inputKey("practice");
  const slot = feedbackShown ? state.slots.practice : state.slots[mode];
  const stale = slot.status === "done" && slot.inputKey !== inputKey(feedbackShown ? "practice" : mode);
  // The generated question fills the question box and clears the previous answer.
  const generated = state.slots.question.result?.kind === "question" ? state.slots.question.result.question : null;
  useEffect(() => {
    if (generated) {
      setQuestion(generated);
      setAnswer("");
    }
  }, [generated]);
  const skill = skills.find((s) => s.category === category);
  const bad = skills.filter((s) => s.error);

  /** Changing what is being asked cancels the running request so its answer cannot land on the new question. */
  const cancelRunning = () => {
    for (const m of ["explain", "practice", "question"] as const) {
      const s = state.slots[m];
      if (isBusy(s)) {
        if (s.requestId) api.aiCancel(s.requestId).catch(() => {});
        dispatch({ type: "cancel", mode: m });
      }
    }
  };
  const change = <T,>(set: (v: T) => void) => (v: T) => {
    cancelRunning();
    set(v);
  };

  const run = async (m: InterviewMode, asked?: string) => {
    if (asked === undefined && busy && state.slots[m].status !== "idle") return; // one call at a time; a repeat click is ignored
    const q = asked ?? question;
    dispatch({
      type: "starting",
      mode: m,
      inputKey: JSON.stringify([category, role, m === "explain" ? style : null, m, category === "coding" ? language : null, q.trim(), ""]),
    });
    try {
      const id = await api.interviewRun({
        category,
        mode: m,
        question: q,
        answer: m === "practice" ? answer : null,
        language: category === "coding" ? language : null,
        role,
        style: m === "explain" ? style : null,
      });
      dispatch({ type: "started", mode: m, requestId: id });
    } catch (e) {
      dispatch({ type: "startFailed", mode: m, error: errorText(e) });
    }
  };

  // Live interview: when the interviewer asks a question, answer it here automatically.
  const running = live.status?.state === "running";
  const [autoLive, setAutoLive] = useState(() => {
    try {
      return localStorage.getItem("ml.ivAuto") !== "off";
    } catch {
      return true;
    }
  });
  const toggleAuto = (v: boolean) => {
    setAutoLive(v);
    try {
      localStorage.setItem("ml.ivAuto", v ? "on" : "off");
    } catch {
      /* not essential */
    }
  };
  useEffect(() => {
    // While this screen answers questions, the Meeting screen's auto-assist stays quiet.
    api.setInterviewLive(autoLive).catch(() => {});
    return () => void api.setInterviewLive(false).catch(() => {});
  }, [autoLive]);
  const lastAsked = useRef<number>(0);
  const autoRef = useRef({ run, cancelRunning });
  autoRef.current = { run, cancelRunning };
  useEffect(() => {
    const q = live.question;
    if (!autoLive || !running || !q || q.at === lastAsked.current || mode !== "explain") return;
    lastAsked.current = q.at;
    autoRef.current.cancelRunning();
    setQuestion(q.text);
    void autoRef.current.run("explain", q.text);
  }, [live.question?.at, autoLive, running, mode]);

  const fromMeeting = useMemo(() => latestQuestion(live.question?.text, live.transcript.finals), [live.question, live.transcript.finals]);

  return (
    <div ref={grid} className="interview" style={{ ["--split" as string]: `minmax(0, ${split}fr) 16px minmax(0, ${100 - split}fr)` }}>
      <section className="panel iv-input">
        <header>
          <h2>Interview practice</h2>
          <div className="seg" role="group" aria-label="Mode">
            <button className={mode === "explain" ? "active" : ""} aria-pressed={mode === "explain"} onClick={() => setMode("explain")}>
              Explain answer
            </button>
            <button className={mode === "practice" ? "active" : ""} aria-pressed={mode === "practice"} onClick={() => setMode("practice")}>
              Practice first
            </button>
            <button className={mode === "question" ? "active" : ""} aria-pressed={mode === "question"} onClick={() => setMode("question")}>
              Mock practice
            </button>
          </div>
        </header>
        <div className="iv-body">
          <label className="check iv-auto">
            <input type="checkbox" checked={autoLive} onChange={(e) => toggleAuto(e.target.checked)} />
            Answer the interviewer's questions automatically while the interview is running
          </label>
          <p className="hint">
            {running ? (autoLive ? "Listening. When the interviewer asks a question, your answer appears on the right." : "Listening, but automatic answers are off. Paste a question and press Explain answer.") : "Press Start interview at the top. The interviewer's questions are answered here, not in the Meeting screen."}
          </p>
          <div className="iv-row">
            <label>
              <span>Role</span>
              <select
                value={role}
                onChange={(e) => {
                  const r = ROLES.find((x) => x[0] === e.target.value)!;
                  cancelRunning();
                  setRole(r[0]);
                  setCategory(r[2]);
                }}
              >
                {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label>
              <span>Category</span>
              <select value={category} onChange={(e) => change(setCategory)(e.target.value as InterviewCategory)}>
                {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            {mode === "explain" && (
              <label>
                <span>Answer style</span>
                <select value={style} title={STYLES.find((x) => x[0] === style)?.[2]} onChange={(e) => change(setStyle)(e.target.value as InterviewStyle)}>
                  {STYLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
            )}
            {category === "coding" && (
              <label>
                <span>Answer language</span>
                <select value={language} onChange={(e) => change(setLanguage)(e.target.value as InterviewLanguage)}>
                  {LANGUAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
            )}
          </div>
          {skill?.description && <p className="iv-skill">Skill: <code>{skill.name}</code>. {skill.description}</p>}
          {bad.map((s) => <div key={s.name} className="banner banner-bad">{s.error}</div>)}

          <label className="iv-field">
            <span>Question {mode === "practice" ? "(you will answer it first)" : mode === "question" ? "(written for you)" : ""}</span>
            <textarea
              value={question}
              onChange={(e) => change(setQuestion)(e.target.value)}
              placeholder={`Type or paste a question. For example: ${HINTS[category]}`}
              rows={3}
            />
          </label>
          <div className="iv-actions">
            <button className="btn btn-ghost btn-sm" disabled={!fromMeeting} onClick={() => change(setQuestion)(fromMeeting)} title="Copies the newest question heard from the other side in the live meeting. Nothing is sent to the AI until you ask.">
              Use the latest question from the meeting
            </button>
            <span className="iv-note">Editable. Nothing is sent until you press the button below.</span>
          </div>

          {(mode === "practice" || (mode === "question" && question.trim())) && (
            <label className="iv-field">
              <span>Your answer</span>
              <textarea value={answer} onChange={(e) => change(setAnswer)(e.target.value)} placeholder="Answer as you would in the interview. Feedback appears after you submit." rows={6} />
            </label>
          )}

          <div className="iv-actions">
            {mode === "explain" ? (
              <button className="btn btn-primary" disabled={!question.trim() || isBusy(slot)} onClick={() => run("explain")}>
                {isBusy(slot) ? "Writing…" : "Explain answer"}
              </button>
            ) : mode === "question" ? (
              <>
                <button className={`btn ${question.trim() ? "" : "btn-primary"}`} disabled={busy} onClick={() => run("question")}>
                  {isBusy(state.slots.question) ? "Writing a question…" : question.trim() ? "Next question" : "Give me a question"}
                </button>
                {question.trim() && (
                  <button className="btn btn-primary" disabled={!answer.trim() || busy} onClick={() => run("practice")}>
                    {isBusy(state.slots.practice) ? "Reviewing…" : "Check my answer"}
                  </button>
                )}
              </>
            ) : (
              <button className="btn btn-primary" disabled={!question.trim() || !answer.trim() || isBusy(slot)} onClick={() => run("practice")}>
                {isBusy(slot) ? "Reviewing…" : "Check my answer"}
              </button>
            )}
            {busy && (
              <button className="btn btn-ghost" onClick={cancelRunning}>
                Cancel
              </button>
            )}
          </div>
        </div>
      </section>

      <Splitter value={split} onChange={setSplit} container={grid} reset={IV_DEFAULT} />

      <section className="iv-output" aria-live="polite">
        <div className="iv-notes card">
          <div>
            <strong>Practice notes</strong>
            <p className="hint">
              {savedCount} answer{savedCount === 1 ? "" : "s"} saved this session ({allCount} in total). Download the questions, your answers, scripts and feedback to study later.
            </p>
            {noteMsg && <p className="hint">{noteMsg}</p>}
          </div>
          <div className="iv-notes-actions">
            <span className="hint">This session:</span>
            <NotesDownload disabled={savedCount === 0} onPick={(f) => download(f, "session")} />
            <span className="hint">Everything:</span>
            <NotesDownload disabled={allCount === 0} onPick={(f) => download(f, "all")} />
            <button className="btn btn-ghost btn-sm" onClick={() => { onNewSession(); setNoteMsg(null); }} title="Start a fresh set of notes. Nothing is deleted.">New session</button>
          </div>
        </div>
        {slot.status === "idle" && (
          <div className="how">
            <p className="empty">{mode === "explain" && running && autoLive ? "Listening for the interviewer. When a question is asked, the answer is written here automatically." : mode === "explain" ? "Get a spoken answer plus the reasoning behind it." : mode === "question" ? "Get a mock question for your role, answer it, then get feedback." : "Answer first. Then get feedback on correctness, missing points, structure and clarity."}</p>
            <ol className="how-steps">
              <li><b>Pick a category</b><span>Each one uses its own coaching skill.</span></li>
              <li><b>{mode === "explain" ? "Ask or paste a question" : "Write your answer"}</b><span>{mode === "explain" ? "Type it, or copy the latest one from your meeting." : "No coaching is shown until you submit."}</span></li>
              <li><b>Check the facts</b><span>Answers are generated by your connected answer engine. Treat them as coaching, not verified facts.</span></li>
            </ol>
          </div>
        )}
        <ScreenAssist />
        <ManualAnswers live={live} />
        <Result slot={slot} stale={stale} onModelAnswer={mode === "practice" || feedbackShown ? () => { setMode("explain"); void run("explain"); } : undefined} />
        <div className="iv-ask-bar">
          <ActionBar live={live} onError={onError} />
        </div>
      </section>
    </div>
  );
}
