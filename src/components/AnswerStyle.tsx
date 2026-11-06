import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { api, errorText } from "../lib/api";
import type { Settings } from "../lib/types";

const LEVELS: [Settings["answer_level"], string, string][] = [
  ["simple", "Simple", "Everyday words"],
  ["professional", "Professional", "Clear business English"],
  ["student", "Student", "Step by step, with a self-check question"],
];
const LENGTHS: [Settings["answer_length"], string][] = [["short", "Short"], ["normal", "Normal"], ["detailed", "Detailed"]];

/** How answers read: the level and the length. Applies to the next answer. */
export function AnswerStyle({ onError }: { onError?: (m: string) => void }) {
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => {
    api.getSettings().then(setS).catch(() => {});
    const un = listen<Settings>("settings-changed", (e) => setS(e.payload));
    return () => void un.then((f) => f()).catch(() => {});
  }, []);
  if (!s) return null;
  const save = (patch: Partial<Settings>) => {
    const next = { ...s, ...patch };
    setS(next);
    api.saveSettings(next).catch((e) => onError?.(errorText(e)));
  };
  return (
    <div className="astyle" role="group" aria-label="How answers read">
      <span className="astyle-grp">
        <i>Level</i>
        {LEVELS.map(([v, l, t]) => <button key={v} title={t} className={s.answer_level === v ? "on" : ""} aria-pressed={s.answer_level === v} onClick={() => save({ answer_level: v })}>{l}</button>)}
      </span>
      <span className="astyle-grp">
        <i>Length</i>
        {LENGTHS.map(([v, l]) => <button key={v} className={s.answer_length === v ? "on" : ""} aria-pressed={s.answer_length === v} onClick={() => save({ answer_length: v })}>{l}</button>)}
      </span>
    </div>
  );
}
