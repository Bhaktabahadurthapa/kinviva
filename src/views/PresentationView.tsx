import { ToolRun } from "../components/tools/ToolRun";
import type { LiveState } from "../lib/liveReducer";

/** Presentation Copilot: prepare, rehearse, and handle questions. Slides come from your Documents or pasted text. */
export function PresentationView({ live, running, onError, onChanged, onBoard }: { live: LiveState; running: boolean; onError: (m: string) => void; onChanged: () => void; onBoard: () => void }) {
  const lines = live.transcript.finals.length;
  return (
    <div className="tc-tool tools-page">
      <header>
        <h1>Presentation</h1>
        <p className="hint">Add your slides or PDF in Documents (they are used automatically), or paste the outline below. To rehearse, press Start above and speak; to handle questions, keep the session running while people ask. {running ? `Listening: ${lines} sentence${lines === 1 ? "" : "s"}.` : ""}</p>
      </header>
      <ToolRun kind="speaker_notes" title="Speaker notes" help="Notes for each slide, transitions, and likely questions. Only uses what is in your material." button="Write speaker notes" placeholder="Paste your slide titles and bullets (or leave empty to use your Documents)" onError={onError} onSaved={onChanged} onBoard={onBoard} rows={6} />
      <ToolRun kind="rehearsal_feedback" title="Rehearsal feedback" help="Paste what you said (or type your script) and get feedback on clarity, structure and pace." button="Give me feedback" placeholder="Your spoken text or script" inputRequired onError={onError} onSaved={onChanged} rows={6} />
      <ToolRun kind="audience_qa" title="Audience questions" help="Suggested answers to the questions the audience asked in this session, grounded in your material." button="Suggest answers" onError={onError} onSaved={onChanged} />
      <ToolRun kind="technical_explain" title="Explain it simply" help="Turn a hard slide into plain words you can say aloud." button="Explain" placeholder="Paste the slide text" inputRequired onError={onError} onSaved={onChanged} onBoard={onBoard} rows={3} />
    </div>
  );
}
