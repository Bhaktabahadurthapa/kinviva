import { useMemo, useState } from "react";
import { allFrames, DECK_THEMES, type DeckPlan, type DeckSlide, type SlideLayout } from "../../lib/deck";
import { SlidePreview } from "./SlidePreview";

const LAYOUTS: [SlideLayout, string][] = [["bullets", "Key points"], ["two_column", "Two columns"], ["stat", "Big number"], ["steps", "Steps"], ["quote", "Statement"], ["summary", "Summary"]];

/** Side-by-side editor: the slide as it will look on one side, its fields on the other. */
export function DeckEditor({ plan, onChange, themeId, author }: { plan: DeckPlan; onChange: (p: DeckPlan) => void; themeId: string; author: string }) {
  const [sel, setSel] = useState(0); // 0 is the opening slide
  const theme = DECK_THEMES.find((t) => t.id === themeId) ?? DECK_THEMES[0];
  const frames = useMemo(() => allFrames(plan, author, theme), [plan, author, theme]);
  const at = Math.min(sel, plan.slides.length);
  const slide = at > 0 ? plan.slides[at - 1] : null;
  const setSlide = (patch: Partial<DeckSlide>) => onChange({ ...plan, slides: plan.slides.map((s, k) => (k === at - 1 ? { ...s, ...patch } : s)) });
  const swap = (d: number) => {
    const i = at - 1;
    const j = i + d;
    if (j < 0 || j >= plan.slides.length) return;
    const s = [...plan.slides];
    [s[i], s[j]] = [s[j], s[i]];
    onChange({ ...plan, slides: s });
    setSel(j + 1);
  };
  const add = () => {
    const s = [...plan.slides];
    s.splice(at, 0, { layout: "bullets", title: "New slide", bullets: ["First point", "Second point"], stat: null, notes: "" });
    onChange({ ...plan, slides: s });
    setSel(at + 1);
  };
  const dup = () => {
    if (!slide) return;
    const s = [...plan.slides];
    s.splice(at, 0, { ...slide, bullets: [...slide.bullets] });
    onChange({ ...plan, slides: s });
    setSel(at + 1);
  };
  const del = () => {
    if (!slide || plan.slides.length <= 2) return;
    onChange({ ...plan, slides: plan.slides.filter((_, k) => k !== at - 1) });
    setSel(Math.max(1, at - 1));
  };

  return (
    <div className="de">
      <ol className="de-thumbs" aria-label="Slides">
        {frames.map((f, i) => (
          <li key={i}>
            <button className={i === at ? "on" : ""} onClick={() => setSel(i)} aria-label={`Slide ${i + 1}`} aria-current={i === at}>
              <span className="de-no">{i + 1}</span>
              <SlidePreview frame={f} label={`Slide ${i + 1}`} />
            </button>
          </li>
        ))}
      </ol>
      <div className="de-main">
        <SlidePreview frame={frames[at]} label={`Slide ${at + 1} preview`} />
        <p className="hint">Slide {at + 1} of {frames.length}. This is how it will look in the file.</p>
      </div>
      <div className="de-form">
        {!slide ? (
          <>
            <h3>Opening slide</h3>
            <label>Title<input value={plan.title} maxLength={90} onChange={(e) => onChange({ ...plan, title: e.target.value })} /></label>
            <label>Subtitle<input value={plan.subtitle} maxLength={140} onChange={(e) => onChange({ ...plan, subtitle: e.target.value })} /></label>
            <div className="tc-actions"><button className="btn btn-sm" onClick={add}>+ Add a slide after this</button></div>
          </>
        ) : (
          <>
            <h3>Edit slide {at + 1}</h3>
            <label>Title<input value={slide.title} maxLength={90} onChange={(e) => setSlide({ title: e.target.value })} /></label>
            <label>Layout<select value={slide.layout} onChange={(e) => { const layout = e.target.value as SlideLayout; setSlide({ layout, stat: layout === "stat" ? (slide.stat ?? { value: "0", label: "Add what this number means" }) : slide.stat }); }}>{LAYOUTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            {slide.layout === "stat" && (
              <div className="de-row">
                <label>Number<input value={slide.stat?.value ?? ""} maxLength={14} onChange={(e) => setSlide({ stat: { value: e.target.value, label: slide.stat?.label ?? "" } })} /></label>
                <label>What it means<input value={slide.stat?.label ?? ""} maxLength={80} onChange={(e) => setSlide({ stat: { value: slide.stat?.value ?? "", label: e.target.value } })} /></label>
              </div>
            )}
            <label>Points, one per line<textarea rows={6} value={slide.bullets.join("\n")} onChange={(e) => setSlide({ bullets: e.target.value.split("\n").slice(0, 6) })} /></label>
            <label>Speaker notes<textarea rows={3} value={slide.notes} onChange={(e) => setSlide({ notes: e.target.value })} /></label>
            <div className="tc-actions">
              <button className="btn btn-sm" onClick={() => swap(-1)} disabled={at === 1}>Move up</button>
              <button className="btn btn-sm" onClick={() => swap(1)} disabled={at === plan.slides.length}>Move down</button>
              <button className="btn btn-sm" onClick={dup}>Duplicate</button>
              <button className="btn btn-sm" onClick={add}>+ Add after</button>
              <button className="btn btn-sm btn-danger" onClick={del} disabled={plan.slides.length <= 2}>Delete</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
