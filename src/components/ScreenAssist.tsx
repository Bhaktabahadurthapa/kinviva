import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { api, errorText, inTauri } from "../lib/api";
import { AiText } from "./AiText";

interface ScreenEvent {
  request_id: string;
  state: "starting" | "streaming" | "done" | "error" | "cancelled";
  text: string;
  error: string | null;
}

/** Splits the screen answer's code blocks from prose so code keeps its layout. */
export function splitCode(text: string): { code: boolean; text: string }[] {
  const parts: { code: boolean; text: string }[] = [];
  text.split(/```[a-zA-Z+#]*\n?/).forEach((chunk, i) => {
    if (chunk.trim()) parts.push({ code: i % 2 === 1, text: i % 2 === 1 ? chunk.replace(/\n$/, "") : chunk });
  });
  return parts;
}

/**
 * "Read my screen": explains what the other person is showing (a coding problem, a
 * command, an error). Starts from the button, the shortcut, or a spoken cue when that
 * is turned on in Settings. Works in the main window and the overlay.
 */
export function ScreenAssist({ compact }: { compact?: boolean }) {
  const [ev, setEv] = useState<ScreenEvent | null>(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!inTauri) return;
    const sub = listen<ScreenEvent>("screen-event", (e) => {
      setEv(e.payload);
      setHidden(false);
    });
    return () => void sub.then((un) => un());
  }, []);
  const busy = ev?.state === "starting" || ev?.state === "streaming";
  const read = () => {
    setEv({ request_id: "", state: "starting", text: "", error: null });
    setHidden(false);
    api.screenRead().catch((e) => setEv({ request_id: "", state: "error", text: "", error: errorText(e) }));
  };
  return (
    <div className={`screen-assist${compact ? " is-compact" : ""}`}>
      <div className="screen-head">
        <button className="btn btn-sm" onClick={read} disabled={busy} title="Sends a screenshot of your main display to your AI provider, only when you press this (or use the shortcut)">
          {busy ? "Reading the screen…" : "Read my screen"}
        </button>
        <span className="hint">Explains a coding question, command or error that is on your screen. The screenshot goes to your AI provider.</span>
      </div>
      {ev && !hidden && ev.state !== "starting" && (
        <div className="screen-result" role="status">
          <button className="btn btn-ghost btn-sm screen-close" onClick={() => setHidden(true)} aria-label="Hide screen answer">✕</button>
          {ev.state === "error" ? (
            <div className="banner banner-bad" role="alert">{ev.error}</div>
          ) : (
            splitCode(ev.text).map((p, i) => (p.code ? <pre key={i} className="iv-code"><code>{p.text}</code></pre> : <AiText key={i} text={p.text} streaming={ev.state === "streaming"} />))
          )}
        </div>
      )}
    </div>
  );
}
