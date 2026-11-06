import { useState } from "react";
import { api, errorText } from "../../lib/api";
import { latestGuard } from "../../lib/latest";

interface Quiz { topic: string; questions: { q: string; choices: string[]; answer: number; explanation: string }[] }
const guard = latestGuard();

/** Practice questions: pick answers, see the score, and the score is kept on this computer. */
export function QuizRunner({ onError, onRecorded }: { onError: (m: string) => void; onRecorded: () => void }) {
  const [topic, setTopic] = useState("");
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [picked, setPicked] = useState<(number | null)[]>([]);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const make = async () => {
    const mine = guard.next();
    setBusy(true);
    setQuiz(null);
    setDone(false);
    try {
      const q = JSON.parse(await api.studioGenerate(crypto.randomUUID(), "quiz", topic.trim() || undefined)) as Quiz;
      if (guard.isCurrent(mine)) (setQuiz(q), setPicked(q.questions.map(() => null)));
    } catch (e) {
      if (guard.isCurrent(mine)) onError(errorText(e));
    } finally {
      if (guard.isCurrent(mine)) setBusy(false);
    }
  };
  const score = quiz ? quiz.questions.filter((q, i) => picked[i] === q.answer).length : 0;
  const finish = async () => {
    if (!quiz) return;
    setDone(true);
    try {
      await api.quizRecord(quiz.topic || topic || "Quiz", quiz.questions.length, score);
      onRecorded();
    } catch (e) {
      onError(errorText(e));
    }
  };
  return (
    <section className="dash-card tool">
      <header><h2>Practice questions</h2></header>
      <p className="hint">Multiple-choice questions on a topic, or on the lecture so far when the topic is empty. Your score is saved on this computer.</p>
      <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Topic, for example: Kubernetes services" aria-label="Quiz topic" maxLength={200} />
      <div className="tc-actions"><button className="btn btn-primary" onClick={() => void make()} disabled={busy}>{busy ? "Writing questions…" : "Make a quiz"}</button></div>
      {quiz && (
        <ol className="quiz">
          {quiz.questions.map((q, i) => (
            <li key={i}>
              <strong>{q.q}</strong>
              <div role="radiogroup" aria-label={q.q}>
                {q.choices.map((c, j) => (
                  <label key={j} className={`quiz-choice ${done ? (j === q.answer ? "right" : picked[i] === j ? "wrong" : "") : ""}`}>
                    <input type="radio" name={`q${i}`} disabled={done} checked={picked[i] === j} onChange={() => setPicked((p) => p.map((x, k) => (k === i ? j : x)))} />{c}
                  </label>
                ))}
              </div>
              {done && q.explanation && <p className="hint">{q.explanation}</p>}
            </li>
          ))}
        </ol>
      )}
      {quiz && !done && <button className="btn btn-primary" onClick={() => void finish()} disabled={picked.some((p) => p === null)}>Check my answers</button>}
      {quiz && done && <p role="status"><strong>{score} of {quiz.questions.length} correct.</strong> Score saved.</p>}
    </section>
  );
}
