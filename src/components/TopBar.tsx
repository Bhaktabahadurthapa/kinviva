import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { loadAppearance, saveAppearance, type Theme } from "../lib/appearance";
import type { Tab } from "../lib/nav";
import type { SearchHit } from "../lib/platform";
import type { Settings } from "../lib/types";

const KIND_LABEL: Record<string, string> = {
  session: "Session", transcript: "Transcript", note: "Note", whiteboard: "Whiteboard", chart: "Chart", incident: "Incident",
  diagram: "Diagram", document: "Document", discover: "Discover",
};
export const HIT_TAB: Record<string, Tab> = {
  session: "sessions", transcript: "sessions", note: "notes", whiteboard: "whiteboard", chart: "visuals", incident: "technical",
  diagram: "architecture", document: "documents", discover: "discover",
};

const THEMES: [Theme, string, string][] = [
  ["light", "Light", "M12 3v2M12 19v2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M3 12h2M19 12h2M5.6 18.4L7 17M17 7l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"],
  ["system", "Match my computer", "M3 5h18v12H3zM8 21h8M12 17v4"],
  ["dark", "Dark", "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"],
];

/** One-click switch between light, dark and the computer's own setting. */
function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>(() => loadAppearance().theme);
  const pick = (t: Theme) => {
    setTheme(t);
    saveAppearance({ ...loadAppearance(), theme: t });
  };
  return (
    <div className="theme-switch" role="radiogroup" aria-label="Colour theme">
      {THEMES.map(([t, label, d]) => (
        <button key={t} role="radio" aria-checked={theme === t} aria-label={label} title={label} className={theme === t ? "on" : ""} onClick={() => pick(t)}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
        </button>
      ))}
    </div>
  );
}

/** Search across everything stored on this computer, plus the profile shortcut. */
export function TopBar({ settings, logo, collapsed, onToggle, onOpenHit, onSettings }: { settings: Settings | null; logo: ReactNode; collapsed: boolean; onToggle: () => void; onOpenHit: (h: SearchHit) => void; onSettings: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mine = ++seq.current;
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = window.setTimeout(() => {
      api.globalSearch(q).then((r) => mine === seq.current && setHits(r.filter((h) => h.kind !== "learning"))).catch(() => mine === seq.current && setHits([]));
    }, 180);
    return () => window.clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  const initial = (settings?.profile_name || settings?.profile_role || "Me").trim().charAt(0).toUpperCase();
  return (
    <header className="topbar" data-tauri-drag-region>
      <div className="topbar-brand" data-tauri-drag-region>
        <button className="rail-toggle" onClick={onToggle} aria-label={collapsed ? "Show the menu" : "Hide the menu"} aria-expanded={!collapsed} title={collapsed ? "Show the menu (Cmd/Ctrl+B)" : "Hide the menu (Cmd/Ctrl+B)"}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        </button>
        {logo}
        <span className="brand-name">Kin<em>viva</em></span>
      </div>
      <div className="topbar-search" ref={box}>
        <svg className="search-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
        <input
          ref={input}
          type="search"
          value={q}
          placeholder="Search sessions, notes, documents, diagrams…"
          aria-label="Search everything"
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => e.key === "Escape" && (setOpen(false), (e.target as HTMLInputElement).blur())}
        />
        <kbd className="search-kbd" aria-hidden>{navigator.platform.includes("Mac") ? "⌘K" : "Ctrl K"}</kbd>
        {open && q.trim().length >= 2 && (
          <div className="search-pop" role="listbox">
            {hits.length === 0 ? (
              <p className="hint">Nothing found for “{q.trim()}”.</p>
            ) : (
              hits.map((h) => (
                <button key={`${h.kind}${h.id}`} role="option" aria-selected="false" className="search-hit" onClick={() => { setOpen(false); setQ(""); onOpenHit(h); }}>
                  <span className="search-kind">{KIND_LABEL[h.kind] ?? h.kind}</span>
                  <span className="search-title">{h.title}</span>
                  {h.snippet && <span className="search-snip">{h.snippet}</span>}
                </button>
              ))
            )}
          </div>
        )}
      </div>
      <ThemeSwitch />
      <button className="topbar-icon" onClick={onSettings} title="Settings" aria-label="Settings">
        <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.7a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.7h4l.4-2.7a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z" /></svg>
      </button>
      <button className="topbar-profile" onClick={onSettings} title={settings?.profile_role ? `${settings.profile_role}: open settings` : "Open settings"} aria-label="Settings and profile">
        <span className="avatar" aria-hidden>{initial}</span>
      </button>
    </header>
  );
}
