import { useState } from "react";
import { api, errorText } from "../lib/api";
import type { Settings } from "../lib/types";
import { AnswerStyle } from "./AnswerStyle";

const SCREENS: [string, string, string][] = [
  ["meeting", "Meetings", "Explanations and replies while people talk"],
  ["interview", "Interviews", "Answers to the interviewer's questions"],
  ["classroom", "Classroom", "Notes, study guides, flashcards, homework hints"],
  ["technical", "Technical Copilot", "Explaining, troubleshooting, diagrams"],
  ["presentation", "Presentation", "Speaker notes, slides, rehearsal feedback"],
];
const PRESETS: [string, string][] = [
  ["Explain like I'm new", "Explain as if I am new to this. Define every new term the first time and use one everyday comparison."],
  ["Short and direct", "Keep answers short and direct. Put the answer first. No filler."],
  ["Formal and professional", "Write in a formal, professional tone suited to a senior colleague or interviewer."],
  ["Step by step", "Teach step by step, in numbered steps, one idea per step."],
  ["Examples from my field", "Use examples from my own field (see About me) whenever an example helps."],
  ["End with a question", "End with one useful question I could ask next."],
  ["Bullets only", "Use short bullet points only, no long paragraphs."],
  ["Plain English", "Use plain English and avoid jargon. If a technical word is needed, explain it in a few words."],
];
const MINE_KEY = "ml.myPresets";
const mine = (): [string, string][] => {
  try { return JSON.parse(localStorage.getItem(MINE_KEY) ?? "[]") as [string, string][]; } catch { return []; }
};

/** The user's own instructions: who they are, what they want on each screen, ready-made styles, and a preview of what is sent. */
export function InstructionsPanel({ s, set, onSave }: { s: Settings; set: <K extends keyof Settings>(k: K, v: Settings[K]) => void; onSave: () => void }) {
  const [screen, setScreen] = useState("meeting");
  const [preview, setPreview] = useState("");
  const [custom, setCustom] = useState<[string, string][]>(mine);
  const text = s.screen_instructions?.[screen] ?? "";
  const setText = (v: string) => set("screen_instructions", { ...(s.screen_instructions ?? {}), [screen]: v.slice(0, 800) });
  const add = (t: string) => setText(text.trim() ? (text.includes(t) ? text : `${text.trim()} ${t}`) : t);
  const saveMine = () => {
    const name = window.prompt("Name for this style", "My style")?.trim().slice(0, 30);
    if (!name || !text.trim()) return;
    const next = [...custom.filter(([n]) => n !== name), [name, text.trim()] as [string, string]].slice(-8);
    setCustom(next);
    try { localStorage.setItem(MINE_KEY, JSON.stringify(next)); } catch { /* not essential */ }
  };
  const show = async () => {
    onSave(); // preview what is saved, so save first
    try { setPreview(await api.instructionsPreview(screen)); } catch (e) { setPreview(errorText(e)); }
  };
  const desc = SCREENS.find(([k]) => k === screen)?.[2];

  return (
    <section className="card ip">
      <h2>My instructions</h2>
      <p className="hint">Tell Kinviva who you are and how you want answers. This is added to what is sent to your answer engine. It steers style and focus. Kinviva's own rules still win, so answers never invent facts.</p>

      <div className="field">
        <label htmlFor="about-me">About me (used on every screen)</label>
        <textarea id="about-me" rows={3} maxLength={600} value={s.about_me ?? ""} onChange={(e) => set("about_me", e.target.value)} placeholder="Example: I'm a DevOps engineer preparing for interviews. I know Linux well and I'm new to Kubernetes." />
        <span className="hint">{(s.about_me ?? "").length} / 600</span>
      </div>

      <div className="ip-tabs" role="tablist" aria-label="Screen">
        {SCREENS.map(([k, l]) => <button key={k} role="tab" aria-selected={screen === k} className={screen === k ? "on" : ""} onClick={() => { setScreen(k); setPreview(""); }}>{l}</button>)}
      </div>
      <p className="hint">{desc}</p>
      <textarea rows={4} maxLength={800} value={text} onChange={(e) => setText(e.target.value)} aria-label={`Instructions for ${screen}`} placeholder="Your instructions for this screen. Pick a style below to start, then edit." />
      <div className="ip-presets" aria-label="Ready-made styles">
        {PRESETS.map(([n, t]) => <button key={n} onClick={() => add(t)} title={t}>{n}</button>)}
        {custom.map(([n, t]) => <button key={n} className="mine" onClick={() => add(t)} title={t}>{n}</button>)}
      </div>
      <div className="tc-actions">
        <button className="btn btn-primary" onClick={onSave}>Save instructions</button>
        <button className="btn" onClick={saveMine} disabled={!text.trim()}>Save as my style</button>
        <button className="btn btn-ghost" onClick={() => setText("")} disabled={!text}>Clear this screen</button>
        <button className="btn" onClick={() => void show()}>Preview what is sent</button>
      </div>
      {preview && <pre className="ip-preview" aria-label="What is added to the prompt">{preview}</pre>}

      {(screen === "meeting" || screen === "classroom") && (
        <div className="ip-style"><h3>Answer level and length</h3><AnswerStyle /></div>
      )}
    </section>
  );
}
