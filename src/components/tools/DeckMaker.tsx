import { useState } from "react";
import { api, errorText } from "../../lib/api";
import { chooseDeckPath, safeName } from "../../lib/download";
import { buildDeck, DECK_THEMES, parseDeck, type DeckPlan } from "../../lib/deck";
import type { Settings } from "../../lib/types";

const LAYOUT_LABEL: Record<string, string> = { bullets: "Key points", two_column: "Two columns", stat: "Big number", steps: "Steps", quote: "Statement", summary: "Summary" };
const AUDIENCES = ["Colleagues", "Managers and leaders", "Customers", "Students", "Technical team"];
const TONES = ["Clear and simple", "Formal", "Friendly", "Persuasive"];

/** Turns the user's information into a ready-to-edit PowerPoint file. */
export function DeckMaker({ settings, onError }: { settings: Settings | null; onError: (m: string) => void }) {
  const [info, setInfo] = useState("");
  const [count, setCount] = useState(8);
  const [audience, setAudience] = useState(AUDIENCES[0]);
  const [tone, setTone] = useState(TONES[0]);
  const [theme, setTheme] = useState(DECK_THEMES[0].id);
  const [plan, setPlan] = useState<DeckPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const make = async () => {
    setBusy(true);
    setNote("");
    setPlan(null);
    try {
      const head = `Audience: ${audience}. Tone: ${tone}. Slides after the opening slide: ${count}.\n`;
      setPlan(parseDeck(await api.studioGenerate(crypto.randomUUID(), "slide_deck", head + info.trim())));
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const download = async () => {
    if (!plan) return;
    try {
      const path = await chooseDeckPath(safeName(plan.title, "presentation"));
      if (!path) return;
      const data = await buildDeck(plan, DECK_THEMES.find((t) => t.id === theme) ?? DECK_THEMES[0], settings?.profile_name?.trim() ?? "");
      await api.architectureWriteFile(path, data);
      setNote(`Saved to ${path}. Open it in PowerPoint, Keynote or Google Slides. Speaker notes are included.`);
    } catch (e) {
      onError(errorText(e));
    }
  };
  const move = (i: number, d: number) => plan && setPlan({ ...plan, slides: plan.slides.map((s, k, a) => (k === i ? a[i + d] : k === i + d ? a[i] : s)) });
  const drop = (i: number) => plan && setPlan({ ...plan, slides: plan.slides.filter((_, k) => k !== i) });

  return (
    <section className="dash-card tool deck-maker">
      <header><h2>Create a presentation</h2></header>
      <p className="hint">Type or paste what the talk is about. MeetingLens plans the slides, then saves a PowerPoint file you can edit. It only uses what you write here and your Documents. It does not invent figures.</p>
      <textarea rows={6} value={info} onChange={(e) => setInfo(e.target.value)} maxLength={5800} placeholder="Example: Quarterly update for the platform team. We moved 12 services to Kubernetes, deploys are faster, next quarter we start on databases…" aria-label="What the presentation is about" />
      <div className="deck-opts">
        <label>Audience<select value={audience} onChange={(e) => setAudience(e.target.value)}>{AUDIENCES.map((a) => <option key={a}>{a}</option>)}</select></label>
        <label>Tone<select value={tone} onChange={(e) => setTone(e.target.value)}>{TONES.map((a) => <option key={a}>{a}</option>)}</select></label>
        <label>Slides<select value={count} onChange={(e) => setCount(Number(e.target.value))}>{[5, 6, 8, 10, 12].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        <label>Colours<select value={theme} onChange={(e) => setTheme(e.target.value)}>{DECK_THEMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
      </div>
      <div className="tc-actions"><button className="btn btn-primary" disabled={busy || info.trim().length < 15} onClick={() => void make()}>{busy ? "Planning slides…" : "Plan the slides"}</button></div>
      {plan && (
        <div className="tc-result">
          <h3 className="deck-title">{plan.title}</h3>
          {plan.subtitle && <p className="hint">{plan.subtitle}</p>}
          <ol className="deck-list">
            {plan.slides.map((s, i) => (
              <li key={i}>
                <span className="deck-n">{i + 1}</span>
                <div><strong>{s.title}</strong><span className="deck-layout">{LAYOUT_LABEL[s.layout] ?? s.layout}</span>
                  {s.stat && <span className="deck-stat">{s.stat.value} · {s.stat.label}</span>}
                  {s.bullets.length > 0 && <span className="deck-b">{s.bullets.join(" · ")}</span>}</div>
                <span className="deck-btns">
                  <button className="btn btn-ghost btn-sm" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                  <button className="btn btn-ghost btn-sm" aria-label="Move down" disabled={i === plan.slides.length - 1} onClick={() => move(i, 1)}>↓</button>
                  <button className="btn btn-ghost btn-sm" aria-label={`Remove slide ${i + 1}`} onClick={() => drop(i)}>✕</button>
                </span>
              </li>
            ))}
          </ol>
          <div className="tc-actions"><button className="btn btn-primary" onClick={() => void download()} disabled={plan.slides.length < 2}>Download PowerPoint (.pptx)</button><button className="btn" onClick={() => void make()} disabled={busy}>Plan again</button></div>
        </div>
      )}
      {note && <div className="banner banner-ok">{note}</div>}
    </section>
  );
}
