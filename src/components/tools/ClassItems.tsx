import { useState } from "react";
import { api, errorText } from "../../lib/api";
import { saveToNotes } from "../../lib/notes";

interface Item { type: string; text: string; when: string; quote: string }
const LABEL: Record<string, string> = { assignment: "Homework", deadline: "Deadline", exam: "Exam", reading: "Reading", announcement: "Announcement" };

/** What the teacher announced: homework, deadlines, exams and readings, each with the words that were said. */
export function ClassItems({ onError, onSaved }: { onError: (m: string) => void; onSaved: () => void }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const run = async () => {
    setBusy(true);
    setSaved(false);
    try {
      setItems((JSON.parse(await api.studioGenerate(crypto.randomUUID(), "class_items")) as { items: Item[] }).items);
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const text = (items ?? []).map((i) => `- ${LABEL[i.type] ?? i.type}: ${i.text}${i.when ? ` (${i.when})` : ""}`).join("\n");
  return (
    <section className="dash-card tool">
      <header><h2>Homework, deadlines and exams</h2></header>
      <p className="hint">Finds what the teacher announced so you do not miss it. Only things that were really said are listed, with the words used.</p>
      <div className="tc-actions"><button className="btn btn-primary" onClick={() => void run()} disabled={busy}>{busy ? "Checking…" : "Find announcements"}</button></div>
      {items && items.length === 0 && <p className="hint">Nothing was announced so far.</p>}
      {items && items.length > 0 && (
        <div className="tc-result">
          <ul className="ci-list">
            {items.map((i, k) => (
              <li key={k}>
                <span className={`ci-tag ci-${i.type}`}>{LABEL[i.type] ?? i.type}</span>
                <div><strong>{i.text}</strong>{i.when && <span className="ci-when">{i.when}</span>}<q>{i.quote}</q></div>
              </li>
            ))}
          </ul>
          <div className="tc-actions"><button className="btn btn-ghost btn-sm" disabled={saved} onClick={() => void saveToNotes(text, { title: "Class announcements" }).then(() => { setSaved(true); onSaved(); })}>{saved ? "Saved to notes" : "Save to notes"}</button></div>
        </div>
      )}
    </section>
  );
}
