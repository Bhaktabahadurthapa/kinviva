import { useState } from "react";
import { ClassItems } from "../components/tools/ClassItems";
import { Flashcards } from "../components/tools/Flashcards";
import { QuizRunner } from "../components/tools/QuizRunner";
import { ToolRun } from "../components/tools/ToolRun";
import type { LiveState } from "../lib/liveReducer";

type Tab = "during" | "after" | "practice";
const TABS: [Tab, string][] = [["during", "During class"], ["after", "After class"], ["practice", "Practice"]];

/** Classroom Copilot: keep up in class, turn the lecture into notes, and practise. Study help, not finished coursework. */
export function ClassroomView({ live, running, onError, onChanged, onBoard }: { live: LiveState; running: boolean; onError: (m: string) => void; onChanged: () => void; onBoard: () => void }) {
  const [tab, setTab] = useState<Tab>("during");
  const lines = live.transcript.finals.length;
  return (
    <div className="tc-tool tools-page">
      <header>
        <h1>Classroom</h1>
        <p className="hint">Press Start above while the lecture is playing, choose your course in Meetings → Session (a Class session uses your course files), then use these tools. {running ? `Listening: ${lines} sentence${lines === 1 ? "" : "s"} so far.` : "Nothing is listening right now."}</p>
        <p className="banner banner-info">These tools help you study. They are not a way to submit work written by a tool as your own; follow your school's rules on using assistants.</p>
      </header>
      <nav className="subnav tc-tabs" role="tablist" aria-label="Classroom">
        <div className="subnav-tabs">{TABS.map(([id, l]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{l}</button>)}</div>
      </nav>
      {tab === "during" && (
        <>
          <ToolRun kind="catch_up" title="I'm lost" help="Explains what the teacher is on right now, in simple words, with a question you can ask." button="Catch me up" onError={onError} onSaved={onChanged} onBoard={onBoard} />
          <ClassItems onError={onError} onSaved={onChanged} />
          <ToolRun kind="technical_explain" title="Explain a concept" help="A hard word or idea, in simple words first, then more depth." button="Explain" placeholder="For example: eventual consistency" inputRequired onError={onError} onSaved={onChanged} onBoard={onBoard} rows={2} />
        </>
      )}
      {tab === "after" && (
        <>
          <ToolRun kind="lecture_notes" title="Lecture notes" help="Clean notes from what the lecturer said." button="Write lecture notes" onError={onError} onSaved={onChanged} onBoard={onBoard} />
          <ToolRun kind="study_guide" title="Study guide" help="A guide for a topic from the lecture, using your course files where they help." button="Write a study guide" placeholder="Topic (leave empty to use the lecture)" onError={onError} onSaved={onChanged} onBoard={onBoard} rows={2} />
          <ToolRun kind="homework_hint" title="Homework helper" help="Stuck on a problem? You get what is being asked, the ideas you need and three hints. It never gives the final answer." button="Give me hints" placeholder="Paste the problem or question" inputRequired onError={onError} onSaved={onChanged} rows={4} />
        </>
      )}
      {tab === "practice" && (
        <>
          <Flashcards onError={onError} />
          <QuizRunner onError={onError} onRecorded={onChanged} />
        </>
      )}
    </div>
  );
}
