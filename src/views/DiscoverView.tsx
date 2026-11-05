import { useCallback, useEffect, useState } from "react";
import { AiText } from "../components/AiText";
import { api, errorText } from "../lib/api";
import { sendToBoard } from "../lib/boardInbox";
import { saveToNotes } from "../lib/notes";
import { newId, SOURCES, TOPICS, type DiscoverItem, type Trend } from "../lib/platform";
import type { Settings } from "../lib/types";

type Section = "for_you" | "news" | "repos" | "trends" | "learn" | "saved";
const SECTIONS: [Section, string][] = [["for_you", "For you"], ["news", "Latest news"], ["repos", "GitHub"], ["trends", "Trending skills"], ["learn", "Learning & certifications"], ["saved", "Saved"]];
const OFFICIAL: [string, string, string][] = [
  ["Certifications", "AWS Certification", "https://aws.amazon.com/certification/"],
  ["Certifications", "Microsoft credentials", "https://learn.microsoft.com/en-us/credentials/browse/"],
  ["Certifications", "CNCF / Kubernetes certifications", "https://www.cncf.io/training/certification/"],
  ["Certifications", "HashiCorp certifications", "https://developer.hashicorp.com/certifications"],
  ["Learning paths", "Kubernetes tutorials", "https://kubernetes.io/docs/tutorials/"],
  ["Learning paths", "AWS Skill Builder", "https://skillbuilder.aws/"],
  ["Learning paths", "Microsoft Learn training", "https://learn.microsoft.com/en-us/training/"],
];
const ago = (ms: number | null) => {
  if (!ms) return "no date given";
  const d = Math.floor((Date.now() - ms) / 86_400_000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : d < 60 ? `${d} days ago` : new Date(ms).toLocaleDateString([], { dateStyle: "medium" });
};

/** Real articles and repositories from the sources listed in Settings, ranked on this computer. */
export default function DiscoverView({ settings, onSettings, onError, onChanged, onBoard }: { settings: Settings | null; onSettings: (s: Settings) => void; onError: (m: string) => void; onChanged: () => void; onBoard: () => void }) {
  const [section, setSection] = useState<Section>("for_you");
  const [items, setItems] = useState<DiscoverItem[]>([]);
  const [last, setLast] = useState<number | null>(null);
  const [trends, setTrends] = useState<Trend[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [skill, setSkill] = useState("");
  const [explain, setExplain] = useState<{ id: string; text: string } | null>(null);
  const enabled = !!settings?.discover_enabled;

  const load = useCallback(() => {
    api.discoverList(undefined, false).then(([l, t]) => (setItems(l), setLast(t))).catch((e) => onError(errorText(e)));
    api.discoverTrends().then(setTrends).catch(() => {});
  }, [onError]);
  useEffect(() => load(), [load]);

  const save = async (patch: Partial<Settings>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    try {
      await api.saveSettings(next);
      onSettings(next);
    } catch (e) {
      onError(errorText(e));
    }
  };
  const addSkill = async () => {
    const name = skill.replace(/[^\p{L}\p{N} +#./-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 40);
    if (name.length < 2) return;
    const have = settings?.interests ?? [];
    if (have.some((x) => x.toLowerCase() === name.toLowerCase())) return setNote(`“${name}” is already in your interests.`);
    if (have.length >= 20) return setNote("You can follow up to 20 interests. Remove one first.");
    setSkill("");
    await save({ interests: [...have, name] });
    setNote(`Added “${name}”.${enabled ? " Fetching matching articles and projects…" : " Turn on Discover to see articles and projects for it."}`);
    if (enabled) void refresh();
  };
  const learn = (name: string) =>
    api.learningSave({ id: newId(), kind: "goal", title: `Learn ${name}`, status: "todo", source: "Discover" }).then(() => (setNote(`Added “Learn ${name}” to My Learning. Open it there and press Make a plan for the steps.`), onChanged())).catch((e) => onError(errorText(e)));

  const refresh = async () => {
    setBusy(true);
    setNote("");
    try {
      const r = await api.discoverRefresh();
      setNote(`${r.added} new item${r.added === 1 ? "" : "s"}.${r.failed.length ? ` Could not reach: ${r.failed.join("; ")}` : ""}`);
      load();
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const mark = (it: DiscoverItem, field: "read" | "saved", value: boolean) => {
    setItems((l) => l.map((x) => (x.id === it.id ? { ...x, [field === "read" ? "is_read" : "saved"]: value } : x)));
    api.discoverMark(it.id, field, value).then(() => field === "saved" && onChanged()).catch((e) => onError(errorText(e)));
  };
  const open = (it: DiscoverItem) => {
    mark(it, "read", true);
    api.openExternal(it.url).catch((e) => onError(errorText(e)));
  };
  const explainItem = async (it: DiscoverItem) => {
    setExplain({ id: it.id, text: "Working…" });
    try {
      setExplain({ id: it.id, text: await api.studioGenerate(crypto.randomUUID(), "explain_item", `${it.title}\n${it.summary}\nSource: ${it.source}`) });
    } catch (e) {
      setExplain(null);
      onError(errorText(e));
    }
  };
  const toLearning = (it: DiscoverItem) =>
    api.learningSave({ id: newId(), kind: "resource", title: it.title, status: "todo", url: it.url, source: it.source, detail: it.summary }).then(() => (setNote("Added to My Learning."), onChanged())).catch((e) => onError(errorText(e)));

  const shown = items.filter((i) => (section === "news" ? i.kind === "news" : section === "repos" ? i.kind === "repo" : section === "saved" ? i.saved : true));
  const interests = settings?.interests ?? [];

  return (
    <div className="disc">
      <header className="disc-head">
        <div><h1>Discover</h1><p className="hint">Real articles and repositories from official engineering sources, ranked on this computer for your interests. Nothing is made up: every item links to its source with the date the source gave.</p></div>
        {enabled && <div className="tc-actions"><button className="btn btn-primary" onClick={() => void refresh()} disabled={busy}>{busy ? "Refreshing…" : "Refresh"}</button><span className="hint">{last ? `Updated ${new Date(last).toLocaleString()}` : "Not refreshed yet"}</span></div>}
      </header>

      {!enabled && (
        <section className="dash-card">
          <h2>Turn Discover on</h2>
          <p>Discover downloads headlines from these sources, and searches GitHub for topics you choose. Your interests are used on this computer; the GitHub search includes the topic names. Nothing else is sent, and you can turn it off at any time.</p>
          <p className="hint">{SOURCES.join(" · ")}</p>
          <button className="btn btn-primary" onClick={() => void save({ discover_enabled: true })}>Turn on Discover</button>
        </section>
      )}

      <section className="dash-card disc-profile">
        <h2>Your interests</h2>
        <div className="disc-chips" role="group" aria-label="Interests">
          {TOPICS.map((t) => <button key={t} className={`chip ${interests.includes(t) ? "on" : ""}`} aria-pressed={interests.includes(t)} onClick={() => void save({ interests: interests.includes(t) ? interests.filter((x) => x !== t) : [...interests, t] })}>{t}</button>)}
          {interests.filter((i) => !TOPICS.includes(i)).map((t) => (
            <span key={t} className="chip on chip-custom">{t}
              <button className="chip-x" onClick={() => learn(t)} title={`Add “Learn ${t}” to My Learning`}>Learn</button>
              <button className="chip-x" aria-label={`Remove ${t}`} onClick={() => void save({ interests: interests.filter((x) => x !== t) })}>✕</button>
            </span>
          ))}
        </div>
        <form className="disc-row" onSubmit={(e) => { e.preventDefault(); void addSkill(); }}>
          <input value={skill} onChange={(e) => setSkill(e.target.value)} placeholder="Add any skill or topic, for example Rust, Terraform, Prompt engineering" aria-label="Add a skill or topic" maxLength={40} />
          <button className="btn btn-primary" type="submit" disabled={skill.trim().length < 2}>Add skill</button>
        </form>
        <div className="disc-row">
          <input value={settings?.profile_name ?? ""} onChange={(e) => settings && onSettings({ ...settings, profile_name: e.target.value })} onBlur={() => void save({})} placeholder="Your name" aria-label="Your name" maxLength={40} style={{ maxWidth: 200 }} />
          <input value={settings?.profile_role ?? ""} onChange={(e) => settings && onSettings({ ...settings, profile_role: e.target.value })} onBlur={() => void save({})} placeholder="Your role, for example Cloud engineer" aria-label="Your role" maxLength={60} />
          <select value={settings?.profile_level ?? "intermediate"} onChange={(e) => void save({ profile_level: e.target.value })} aria-label="Skill level"><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select>
          {enabled && <button className="btn btn-ghost btn-sm" onClick={() => void save({ discover_enabled: false })}>Turn off Discover</button>}
        </div>
      </section>

      <div className="seg" role="tablist" aria-label="Discover sections">{SECTIONS.map(([id, l]) => <button key={id} role="tab" aria-selected={section === id} className={section === id ? "active" : ""} onClick={() => setSection(id)}>{l}</button>)}</div>
      {note && <p className="banner banner-info" role="status">{note}</p>}

      {section === "trends" ? (
        trends.length === 0 ? <p className="hint">Trends are counted from the articles stored on this computer. Refresh Discover first.</p> : (
          <table className="vis-table"><thead><tr><th>Topic</th><th>Last 30 days</th><th>Before that (30 days)</th><th>Sources</th></tr></thead>
            <tbody>{trends.map((t) => <tr key={t.topic}><td>{t.topic}</td><td>{t.recent}</td><td>{t.previous}</td><td>{t.sources}</td></tr>)}</tbody></table>
        )
      ) : section === "learn" ? (
        <div className="disc-list">{(["Certifications", "Learning paths"] as const).map((g) => <section key={g} className="dash-card"><h2>{g}</h2><p className="hint">Official pages. MeetingLens does not copy their content or claim dates.</p><ul className="dash-list">{OFFICIAL.filter((o) => o[0] === g).map((o) => <li key={o[2]}><strong>{o[1]}</strong><span className="hint">{o[2].replace("https://", "").split("/")[0]}</span></li>)}</ul></section>)}</div>
      ) : shown.length === 0 ? (
        <p className="hint">{enabled ? "Nothing here yet. Press Refresh." : "Turn Discover on to see articles and repositories."}</p>
      ) : (
        <ul className="disc-list">
          {shown.map((it) => (
            <li key={it.id} className={`disc-item ${it.is_read ? "read" : ""}`}>
              {it.image && <button className="disc-pic" onClick={() => open(it)} aria-label={`Open ${it.title}`}><img src={it.image} alt="" loading="lazy" className={it.kind === "repo" ? "d-avatar" : ""} /></button>}
              <div className="disc-meta"><span className="search-kind">{it.kind === "repo" ? "Repository" : "News"}</span><span>{it.source}</span>{it.topic && <span className="tc-chip">{it.topic}</span>}<span>{ago(it.published_at)}</span>{it.stars != null && <span>★ {it.stars.toLocaleString()}</span>}{it.language && <span>{it.language}</span>}{!it.is_read && <span className="dot-new" title="Unread" />}</div>
              <button className="disc-title" onClick={() => open(it)}>{it.title}</button>
              {it.summary && <p>{it.summary}</p>}
              <div className="tc-actions">
                <button className="btn btn-sm" onClick={() => void explainItem(it)}>Explain</button>
                <button className="btn btn-sm" onClick={() => { sendToBoard(`${it.title}. ${it.summary}`); onBoard(); }}>Visualize</button>
                <button className="btn btn-sm" onClick={() => void saveToNotes(`${it.title}\n${it.url}\n\n${it.summary}`, { title: it.title }).then(() => { setNote("Saved to notes."); onChanged(); })}>Save to notes</button>
                <button className="btn btn-sm" onClick={() => void toLearning(it)}>Add to learning plan</button>
                <button className="btn btn-sm btn-ghost" aria-pressed={it.saved} onClick={() => mark(it, "saved", !it.saved)}>{it.saved ? "Saved" : "Save for later"}</button>
                <button className="btn btn-sm btn-ghost" onClick={() => mark(it, "read", !it.is_read)}>{it.is_read ? "Mark unread" : "Mark read"}</button>
              </div>
              {explain?.id === it.id && <div className="tc-result"><AiText text={explain.text} /></div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
