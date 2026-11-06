import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorText } from "../lib/api";

/** A theatre for videos: play a video file next to the live transcript and answers. Its sound is heard by MeetingLens like any other sound on this computer. */
const RECENT_KEY = "ml.videoRecent";
const loadRecent = (): string[] => {
  try {
    return (JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[]).slice(0, 5);
  } catch {
    return [];
  }
};

export function WatchStage({ caption }: { caption: { who: string; text: string } | null }) {
  const [mode, setMode] = useState<"online" | "file">(() => {
    try {
      return localStorage.getItem("ml.videoMode") === "file" ? "file" : "online";
    } catch {
      return "online";
    }
  });
  const switchMode = (m: "online" | "file") => {
    setMode(m);
    try { localStorage.setItem("ml.videoMode", m); } catch { /* not essential */ }
  };
  // Online video: a real web page (YouTube, Vimeo, a course site) shown inside this window.
  const slot = useRef<HTMLDivElement>(null);
  const [link, setLink] = useState("");
  const [live, setLive] = useState<string | null>(null);
  const [onlineErr, setOnlineErr] = useState("");
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const rect = useCallback(() => {
    const r = slot.current?.getBoundingClientRect();
    return r ? ([r.left, r.top, r.width, r.height] as const) : null;
  }, []);
  const play = async (raw: string) => {
    setOnlineErr("");
    const r = rect();
    if (!r || !raw.trim()) return;
    try {
      const address = await api.videoOpen(raw.trim(), ...r);
      setLive(address);
      setLink(address);
      const next = [address, ...recent.filter((x) => x !== address)].slice(0, 5);
      setRecent(next);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* not essential */ }
    } catch (e) {
      setOnlineErr(errorText(e));
    }
  };
  const stop = () => {
    setLive(null);
    api.videoClose().catch(() => {});
  };
  const paste = async () => {
    try {
      const t = (await api.clipboardText()).trim();
      if (t) {
        setLink(t);
        void play(t);
      }
    } catch {
      setOnlineErr("Could not read the clipboard. Paste the link into the box instead (Cmd+V).");
    }
  };
  // Keep the page exactly over its slot while the window or layout changes; close it when this screen goes away.
  useEffect(() => {
    if (!live || mode !== "online") return;
    let last = "";
    const tick = () => {
      const r = rect();
      if (!r) return;
      const k = r.map(Math.round).join(",");
      if (k !== last) {
        last = k;
        api.videoBounds(...r).catch(() => {});
      }
    };
    const id = window.setInterval(tick, 200);
    window.addEventListener("resize", tick);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("resize", tick);
    };
  }, [live, mode, rect]);
  useEffect(() => () => void api.videoClose().catch(() => {}), []);
  useEffect(() => {
    if (mode === "file" && live) stop();
  }, [mode]);

  const [src, setSrc] = useState<{ url: string; name: string } | null>(null);
  const [drag, setDrag] = useState(false);
  const [err, setErr] = useState("");
  const [cc, setCc] = useState(() => {
    try {
      return localStorage.getItem("ml.watchCc") !== "off";
    } catch {
      return true;
    }
  });
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (src) URL.revokeObjectURL(src.url); }, [src]);

  const load = (f: File | undefined | null) => {
    setErr("");
    if (!f) return;
    if (!/^(video|audio)\//.test(f.type) && !/\.(mp4|m4v|mov|webm|mkv|mp3|m4a|wav)$/i.test(f.name)) return setErr("Choose a video file, for example MP4, MOV or WebM.");
    setSrc({ url: URL.createObjectURL(f), name: f.name });
  };
  const toggleCc = () => {
    setCc((v) => {
      try { localStorage.setItem("ml.watchCc", v ? "off" : "on"); } catch { /* not essential */ }
      return !v;
    });
  };

  return (
    <section className="ws" aria-label="Video">
      <div className="ws-modes" role="group" aria-label="Video source">
        <button className={mode === "online" ? "on" : ""} aria-pressed={mode === "online"} onClick={() => switchMode("online")}>Online video</button>
        <button className={mode === "file" ? "on" : ""} aria-pressed={mode === "file"} onClick={() => switchMode("file")}>Video file</button>
      </div>
      {mode === "online" ? (
        <div className="ws-online">
          <form className="ws-url" onSubmit={(e) => { e.preventDefault(); void play(link); }}>
            <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste a YouTube, Vimeo or course video link" aria-label="Video link" spellCheck={false} />
            <button type="button" className="btn" onClick={() => void paste()}>Paste</button>
            <button type="submit" className="btn btn-primary" disabled={!link.trim()}>Play</button>
            {live && <button type="button" className="btn btn-ghost" onClick={stop}>Close</button>}
          </form>
          {onlineErr && (
            <p className="ws-err-line" role="alert">{onlineErr} {link.trim() && <button type="button" className="ws-linkbtn" onClick={() => void api.videoInBrowser(link).catch((e) => setOnlineErr(errorText(e)))}>Open in my browser instead</button>}</p>
          )}
          {recent.length > 0 && !live && (
            <div className="ws-recent" aria-label="Recent links">{recent.map((r) => <button key={r} onClick={() => { setLink(r); void play(r); }} title={r}>{r.replace(/^https:\/\/(www\.)?/, "").slice(0, 38)}</button>)}</div>
          )}
          <div className="ws-frame ws-slotframe">
            <div ref={slot} className="ws-slot" />
            {!live && (
              <div className="ws-empty">
                <span className="ws-play" aria-hidden><svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M8 5.5v13l11-6.5z" /></svg></span>
                <h3>Watch it here</h3>
                <p>Paste the link of any video page. It plays inside MeetingLens, and the transcript and answers stay beside it.</p>
                <p className="ws-tip">Sign in to the video site once inside this pane if it asks. MeetingLens hears the sound and writes the transcript.</p>
              </div>
            )}
          </div>
          {live && cc && caption && <div className="ws-capstrip" aria-live="polite"><span>{caption.who}</span>{caption.text}</div>}
          {live && <div className="ws-bar"><span className="ws-name" title={live}>{live.replace(/^https:\/\//, "")}</span><button className={`btn btn-sm ${cc ? "" : "btn-ghost"}`} aria-pressed={cc} onClick={toggleCc}>Live captions</button></div>}
        </div>
      ) : (
        <>
      <input ref={input} type="file" accept="video/*,audio/*,.mkv" hidden onChange={(e) => { load(e.target.files?.[0]); e.target.value = ""; }} />
      {!src ? (
        <div className={`ws-drop ${drag ? "over" : ""}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); load(e.dataTransfer.files?.[0]); }}>
          <button className="ws-play" onClick={() => input.current?.click()} aria-label="Choose a video file">
            <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor" aria-hidden><path d="M8 5.5v13l11-6.5z" /></svg>
          </button>
          <h3>Watch a video here</h3>
          <p>Drop a video file, or choose one. It plays on this screen while the transcript and answers stay beside it.</p>
          <button className="btn btn-primary" onClick={() => input.current?.click()}>Choose a video</button>
          {err && <p className="ws-err" role="alert">{err}</p>}
          <p className="ws-tip"><b>Video in your browser?</b> Put the browser and MeetingLens side by side. MeetingLens hears the video's sound and writes the transcript here.</p>
        </div>
      ) : (
        <div className="ws-player">
          <div className="ws-bar">
            <span className="ws-name" title={src.name}>{src.name}</span>
            <button className={`btn btn-sm ${cc ? "" : "btn-ghost"}`} aria-pressed={cc} onClick={toggleCc}>Live captions</button>
            <button className="btn btn-sm" onClick={() => input.current?.click()}>Change</button>
            <button className="btn btn-sm btn-ghost" onClick={() => setSrc(null)}>Close</button>
          </div>
          <div className="ws-frame">
            <video src={src.url} controls playsInline />
            {cc && caption && (
              <div className="ws-cc" aria-live="polite"><span>{caption.who}</span>{caption.text}</div>
            )}
          </div>
        </div>
      )}
        </>
      )}
    </section>
  );
}
