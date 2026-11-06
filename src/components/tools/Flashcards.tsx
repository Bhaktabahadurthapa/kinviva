import { useState } from "react";
import { api, errorText } from "../../lib/api";

interface Card { front: string; back: string }

/** Flip-through revision cards from the lecture, your course files or a topic. */
export function Flashcards({ onError }: { onError: (m: string) => void }) {
  const [topic, setTopic] = useState("");
  const [cards, setCards] = useState<Card[] | null>(null);
  const [i, setI] = useState(0);
  const [flip, setFlip] = useState(false);
  const [known, setKnown] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const r = JSON.parse(await api.studioGenerate(crypto.randomUUID(), "flashcards", topic.trim() || undefined)) as { cards: Card[] };
      setCards(r.cards);
      setI(0);
      setFlip(false);
      setKnown(new Set());
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const go = (d: number) => cards && (setI((x) => (x + d + cards.length) % cards.length), setFlip(false));
  const c = cards?.[i];
  return (
    <section className="dash-card tool">
      <header><h2>Flashcards</h2></header>
      <p className="hint">Revision cards from the lecture so far, your course files, or a topic you type.</p>
      <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Topic (leave empty to use the lecture)" aria-label="Flashcard topic" maxLength={200} />
      <div className="tc-actions"><button className="btn btn-primary" onClick={() => void run()} disabled={busy}>{busy ? "Making cards…" : "Make flashcards"}</button></div>
      {cards && c && (
        <div className="fc">
          <button className={`fc-card ${flip ? "back" : ""}`} onClick={() => setFlip((f) => !f)} aria-label={flip ? "Answer. Press to see the question" : "Question. Press to see the answer"}>
            <span className="fc-side">{flip ? "Answer" : "Question"}</span>
            <span className="fc-text">{flip ? c.back : c.front}</span>
            <span className="fc-hint">Press to flip</span>
          </button>
          <div className="tc-actions fc-nav">
            <button className="btn btn-sm" onClick={() => go(-1)}>Previous</button>
            <span className="hint">{i + 1} of {cards.length} · {known.size} known</span>
            <button className="btn btn-sm" onClick={() => setKnown((k) => { const n = new Set(k); if (n.has(i)) n.delete(i); else n.add(i); return n; })} aria-pressed={known.has(i)}>{known.has(i) ? "Known ✓" : "I know this"}</button>
            <button className="btn btn-sm" onClick={() => go(1)}>Next</button>
          </div>
        </div>
      )}
    </section>
  );
}
