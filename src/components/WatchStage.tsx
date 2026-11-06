import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorText } from "../lib/api";
import type { AiAction } from "./actionTypes";

const RECENT_KEY = "ml.videoRecent";
const loadRecent = (): string[] => {
  try {
    return (JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[]).slice(0, 5);
  } catch {
    return [];
  }
};
const flag = (k: string, d: boolean) => {
  try {
    const v = localStorage.getItem(k);
    return v === null ? d : v === "on";
  } catch {
    return d;
  }
};

const ICON: Record<string, string> = {
  explain: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z",
  reply: "M4 5h16v10H9l-5 4zM8 9h8M8 12h5",
  recap: "M5 6h14M5 12h14M5 18h9",
  captions: "M4 6h16v12H4zM8 11h3M8 14h2M13 11h3M13 14h3",
  browser: "M14 4h6v6M20 4l-9 9M18 14v5H5V6h5",
  close: "M6 6l12 12M18 6L6 18",
  file: "M12 16V4M7 9l5-5 5 5M5 20h14",
};
function RailBtn({ id, label, onClick, on, disabled }: { id: keyof typeof ICON; label: string; onClick: () => void; on?: boolean; disabled?: boolean }) {
  return (
    <button className={`ws-rb ${on ? "on" : ""}`} onClick={onClick} disabled={disabled} title={label} aria-label={label} aria-pressed={on}>
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={ICON[id]} /></svg>
      <span>{label}</span>
    </button>
  );
}

/** A theatre for videos: watch an online video or a file next to the live transcript and answers. Its sound is heard by MeetingLens like any other sound on this computer. */
export function WatchStage({ caption, onAction }: { caption: { who: string; text: string } | null; onAction: (a: AiAction) => void }) {
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
  const [cc, setCc] = useState(() => flag("ml.watchCc", true));
  const toggleCc = () => setCc((v) => {
    try { localStorage.setItem("ml.watchCc", v ? "off" : "on"); } catch { /* not essential */ }
    return !v;
  });

  // ---- Online video: a real web page shown inside this window ----
  const slot = useRef<HTMLDivElement>(null);
  const [link, setLink] = useState("");
  const [live, setLive] = useState<string | null>(null);
  const [info, setInfo] = useState<{ title: string; channel: string } | null>(null);
  const [onlineErr, setOnlineErr] = useState("");
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const rect = useCallback(() => {
    const r = slot.current?.getBoundingClientRect();
    return r ? ([r.left, r.top, r.width, r.height] as const) : null;
  }, []);
  const play = async (raw: string) => {
    setOnlineErr("");
    setInfo(null);
    const r = rect();
    if (!r || !raw.trim()) return;
    try {
      const address = await api.videoOpen(raw.trim(), ...r);
      setLive(address);
      setLink(address);
      const next = [address, ...recent.filter((x) => x !== address)].slice(0, 5);
      setRecent(next);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* not essential */ }
      api.videoInfo(address).then(setInfo).catch(() => {});
    } catch (e) {
      setOnlineErr(errorText(e));
    }
  };
  const stopOnline = () => {
    setLive(null);
    setInfo(null);
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
  // Keep the page exactly over its slot while the window or layout changes.
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
    const id = window.setInterval(tick, 100);
    window.addEventListener("resize", tick);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("resize", tick);
    };
  }, [live, mode, rect]);
  // The page is a native layer above the window, so it steps aside whenever a dialog is open.
  useEffect(() => {
    if (!live) return;
    let hidden = false;
    const check = () => {
      const open = !!document.querySelector(".dialog-backdrop, [aria-modal='true']");
      if (open !== hidden) {
        hidden = open;
        api.videoVisible(!open).catch(() => {});
      }
    };
    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true, subtree: true });
    check();
    return () => {
      mo.disconnect();
      if (hidden) api.videoVisible(true).catch(() => {});
    };
  }, [live]);
  useEffect(() => () => void api.videoClose().catch(() => {}), []);
  useEffect(() => {
    if (mode === "file" && live) stopOnline();
  }, [mode]);

  // ---- Video file ----
  const [src, setSrc] = useState<{ url: string; name: string } | null>(null);
  const [drag, setDrag] = useState(false);
  const [fileErr, setFileErr] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (src) URL.revokeObjectURL(src.url); }, [src]);
  const load = (f: File | undefined | null) => {
    setFileErr("");
    if (!f) return;
    if (!/^(video|audio)\//.test(f.type) && !/\.(mp4|m4v|mov|webm|mkv|mp3|m4a|wav)$/i.test(f.name)) return setFileErr("Choose a video file, for example MP4, MOV or WebM.");
    setSrc({ url: URL.createObjectURL(f), name: f.name });
  };

  const showing = mode === "online" ? !!live : !!src;
  const close = () => (mode === "online" ? stopOnline() : setSrc(null));

  return (
    <section className="ws" aria-label="Video">
      <input ref={input} type="file" accept="video/*,audio/*,.mkv" hidden onChange={(e) => { load(e.target.files?.[0]); e.target.value = ""; }} />
      <nav className="ws-rail" aria-label="Video tools">
        <RailBtn id="explain" label="Explain" onClick={() => onAction("explain")} />
        <RailBtn id="reply" label="Reply" onClick={() => onAction("suggest")} />
        <RailBtn id="recap" label="Recap" onClick={() => onAction("recap")} />
        <span className="ws-rsep" />
        <RailBtn id="captions" label="Captions" on={cc} onClick={toggleCc} />
        {mode === "online" && <RailBtn id="browser" label="Browser" disabled={!live && !link.trim()} onClick={() => void api.videoInBrowser(live ?? link).catch((e) => setOnlineErr(errorText(e)))} />}
        {mode === "file" && <RailBtn id="file" label="Change" onClick={() => input.current?.click()} />}
        <RailBtn id="close" label="Close" disabled={!showing} onClick={close} />
      </nav>
      <div className="ws-main">
        <div className="ws-modes" role="group" aria-label="Video source">
          <button className={mode === "online" ? "on" : ""} aria-pressed={mode === "online"} onClick={() => switchMode("online")}>Online video</button>
          <button className={mode === "file" ? "on" : ""} aria-pressed={mode === "file"} onClick={() => switchMode("file")}>Video file</button>
        </div>
        {mode === "online" ? (
          <>
            <form className="ws-url" onSubmit={(e) => { e.preventDefault(); void play(link); }}>
              <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste a YouTube, Vimeo or course video link" aria-label="Video link" spellCheck={false} />
              <button type="button" className="btn" onClick={() => void paste()}>Paste</button>
              <button type="submit" className="btn btn-primary" disabled={!link.trim()}>Play</button>
            </form>
            {onlineErr && <p className="ws-err-line" role="alert">{onlineErr} {link.trim() && <button type="button" className="ws-linkbtn" onClick={() => void api.videoInBrowser(link).catch((e) => setOnlineErr(errorText(e)))}>Open in my browser instead</button>}</p>}
            {recent.length > 0 && !live && (
              <div className="ws-recent" aria-label="Recent links">{recent.map((r) => <button key={r} onClick={() => { setLink(r); void play(r); }} title={r}>{r.replace(/^https:\/\/(www\.)?/, "").slice(0, 38)}</button>)}</div>
            )}
            {live && (
              <div className="ws-info">
                <div className="ws-chan">{info?.channel || "Video"}</div>
                <div className="ws-title" title={info?.title || live}>{info?.title || live.replace(/^https:\/\//, "")}</div>
              </div>
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
          </>
        ) : !src ? (
          <div className={`ws-drop ${drag ? "over" : ""}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); load(e.dataTransfer.files?.[0]); }}>
            <button className="ws-play" onClick={() => input.current?.click()} aria-label="Choose a video file"><svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor" aria-hidden><path d="M8 5.5v13l11-6.5z" /></svg></button>
            <h3>Play a video file</h3>
            <p>Drop a video file here, or choose one from this computer.</p>
            <button className="btn btn-primary" onClick={() => input.current?.click()}>Choose a video</button>
            {fileErr && <p className="ws-err" role="alert">{fileErr}</p>}
          </div>
        ) : (
          <>
            <div className="ws-info"><div className="ws-chan">Video file</div><div className="ws-title" title={src.name}>{src.name}</div></div>
            <div className="ws-frame ws-filevid">
              <video src={src.url} controls playsInline />
              {cc && caption && <div className="ws-cc" aria-live="polite"><span>{caption.who}</span>{caption.text}</div>}
            </div>
          </>
        )}
        {mode === "online" && live && cc && caption && <div className="ws-capstrip" aria-live="polite"><span>{caption.who}</span>{caption.text}</div>}
      </div>
    </section>
  );
}
