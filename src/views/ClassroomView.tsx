import { QuizRunner } from "../components/tools/QuizRunner";
import { ToolRun } from "../components/tools/ToolRun";
import type { LiveState } from "../lib/liveReducer";

/** Classroom Copilot: notes, study material and practice from the lecture. Study help, not finished coursework. */
export function ClassroomView({ live, running, onError, onChanged, onBoard }: { live: LiveState; running: boolean; onError: (m: string) => void; onChanged: () => void; onBoard: () => void }) {
  const lines = live.transcript.finals.length;
  return (
    <div className="tc-tool tools-page">
      <header>
        <h1>Classroom</h1>
        <p className="hint">Press Start above while the lecture is playing, choose your course in Meetings → Session (a Class session uses your course files), then use these tools. {running ? `Listening: ${lines} sentence${lines === 1 ? "" : "s"} so far.` : lines ? `${lines} sentences are loaded.` : "Nothing transcribed yet."}</p>
        <p className="banner banner-info">These tools help you study. They are not a way to submit AI-written work as your own; follow your school's rules on AI help.</p>
      </header>
      <ToolRun kind="lecture_notes" title="Lecture notes" help="Clean notes from what the lecturer has said so far." button="Write lecture notes" onError={onError} onSaved={onChanged} onBoard={onBoard} />
      <ToolRun kind="study_guide" title="Study guide" help="A guide for a topic from the lecture, using your course files where they help." button="Write a study guide" placeholder="Topic (leave empty to use the lecture)" onError={onError} onSaved={onChanged} onBoard={onBoard} rows={2} />
      <QuizRunner onError={onError} onRecorded={onChanged} />
      <ToolRun kind="technical_explain" title="Explain a concept" help="A hard word or idea, in simple words first, then more depth." button="Explain" placeholder="For example: eventual consistency" inputRequired onError={onError} onSaved={onChanged} onBoard={onBoard} rows={2} />
    </div>
  );
}
