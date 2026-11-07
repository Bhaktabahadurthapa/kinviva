import { useState } from "react";
import { api, errorText } from "../../lib/api";
import { chooseDeckPath, safeName } from "../../lib/download";
import { DeckEditor } from "./DeckEditor";
import { buildDeck, DECK_THEMES, parseDeck, type DeckPlan } from "../../lib/deck";
import type { Settings } from "../../lib/types";

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
  const [wish, setWish] = useState("");

  const make = async () => {
    setBusy(true);
    setNote("");
    try {
      const prev = plan ? `\nThe previous version had these slides: ${plan.slides.map((x) => x.title).join("; ")}.\nMake a DIFFERENT version.${wish.trim() ? ` Changes wanted: ${wish.trim()}` : ""}` : "";
      const head = `Audience: ${audience}. Tone: ${tone}. Slides after the opening slide: ${count}.\n`;
      setPlan(parseDeck(await api.studioGenerate(crypto.randomUUID(), "slide_deck", head + info.trim() + prev)));
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

  return (
    <section className="dash-card tool deck-maker">
      <header><h2>Create a presentation</h2></header>
      <p className="hint">Type or paste what the talk is about. Kinviva plans the slides, then saves a PowerPoint file you can edit. It only uses what you write here and your Documents. It does not invent figures.</p>
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
          <DeckEditor plan={plan} onChange={setPlan} themeId={theme} author={settings?.profile_name?.trim() ?? ""} />
          <div className="deck-again">
            <label>Not happy with it? Say what to change, then make another version<input value={wish} onChange={(e) => setWish(e.target.value)} maxLength={300} placeholder="For example: shorter, more about costs, add a slide on risks" /></label>
          </div>
          <div className="tc-actions"><button className="btn btn-primary" onClick={() => void download()} disabled={plan.slides.length < 2}>Download PowerPoint (.pptx)</button><button className="btn" onClick={() => void make()} disabled={busy}>{busy ? "Working…" : "Make another version"}</button></div>
        </div>
      )}
      {note && <div className="banner banner-ok">{note}</div>}
    </section>
  );
}
