import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { api, errorText } from "../lib/api";
import { defaultBody, defaultSubject, newClaims, type Application } from "../lib/jobs";
import { parseResume, type TemplateId } from "../lib/resume";
import type { Settings } from "../lib/types";

const COUNTDOWN = 10;

/** Review one prepared application and, if you approve, send it from your own email account. Nothing is sent without your click, and you get a few seconds to cancel. */
export function SendPanel({ app, master, template, settings, sentToday, onSent, onPatch, onNote, onError }: {
  app: Application;
  master: string;
  template: TemplateId;
  settings: Settings | null;
  sentToday: number;
  onSent: (count: number, to: string, subject: string) => void;
  onPatch: (patch: Partial<Application>) => void;
  onNote: (m: string) => void;
  onError: (e: unknown) => void;
}) {
  const doc = parseResume(app.resume ?? "");
  const [to, setTo] = useState(app.contact ?? "");
  const [subject, setSubject] = useState(() => defaultSubject(app.title, doc.name));
  const [body, setBody] = useState(() => defaultBody(app.letter, app.title, app.company, doc.name));
  const [left, setLeft] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const timer = useRef<number | null>(null);
  const cap = settings?.send_daily_cap ?? 0;
  const mailReady = !!settings && !!settings.smtp_host.trim() && !!settings.smtp_user.trim() && !!settings.from_email.trim();
  const claims = newClaims(master, `${app.resume ?? ""}\n${body}`);
  const validTo = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(to.trim());

  useEffect(() => () => void (timer.current !== null && window.clearInterval(timer.current)), []);

  const send = async () => {
    setSending(true);
    try {
      const n = await api.jobsSendEmail({ appId: app.id, to: to.trim(), subject, body, resume: doc, template, letter: null, letterHeading: `${app.title}, ${app.company}` });
      onSent(n, to.trim(), subject);
    } catch (e) {
      onError(e);
    } finally {
      setSending(false);
      setLeft(null);
    }
  };
  const start = () => {
    setLeft(COUNTDOWN);
    let n = COUNTDOWN;
    timer.current = window.setInterval(() => {
      n -= 1;
      if (n <= 0) {
        if (timer.current !== null) window.clearInterval(timer.current);
        timer.current = null;
        void send();
      } else setLeft(n);
    }, 1000);
  };
  const cancel = () => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
    setLeft(null);
    onNote("Cancelled. Nothing was sent.");
  };
  const saveFiles = async () => {
    try {
      const dir = await open({ directory: true, multiple: false });
      if (typeof dir !== "string") return;
      const files = await api.packExport(dir, doc, template, body, `${app.title}, ${app.company}`, `${app.company} ${app.title}`);
      onNote(`Saved ${files.length} file${files.length === 1 ? "" : "s"} to ${dir}. Upload them on the employer's page.`);
    } catch (e) {
      onError(e);
    }
  };

  return (
    <div className="jb-send">
      <h4>Review and send</h4>
      {claims.skills.length > 0 || claims.numbers.length > 0 ? (
        <div className="banner banner-bad" role="alert">Mentions things your own resume does not: {[...claims.skills, ...claims.numbers].join(", ")}. Fix them before sending.</div>
      ) : null}
      <label className="jb-date">To (the address in the posting)
        <input value={to} onChange={(e) => (setTo(e.target.value), onPatch({ contact: e.target.value.trim() || undefined }))} placeholder="careers@company.com" aria-label="To" />
      </label>
      {!app.contact && !to && <p className="hint">This posting names no email address, so use the employer's form: save the files below and upload them there.</p>}
      <label className="jb-date">Subject<input value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" /></label>
      <label className="jb-date">Message<textarea className="jb-text" rows={8} value={body} onChange={(e) => setBody(e.target.value)} aria-label="Message" /></label>
      <p className="hint">Attached: {doc.name || "Resume"} resume (Word, {template} layout). From: {settings?.from_name || settings?.from_email || "not set"}.</p>
      {!mailReady && <p className="hint">To send by email, set up your mail account in Settings → Job applications.</p>}
      <div className="disc-row">
        {left === null ? (
          <button className="btn btn-primary" onClick={start} disabled={!mailReady || !validTo || !subject.trim() || !body.trim() || sending || sentToday >= cap}>
            {sending ? "Sending…" : "Approve and send"}
          </button>
        ) : (
          <button className="btn btn-primary" onClick={cancel}>Sending in {left}s. Click to cancel</button>
        )}
        <button className="btn" onClick={() => void saveFiles()}>Save files for a form</button>
        {app.url && <button className="btn" onClick={() => void api.openLink(app.url).catch((e) => onError(errorText(e)))}>Open the application page</button>}
        <button className="btn btn-ghost" onClick={() => (onPatch({ status: "applied" }), onNote("Marked as applied."))}>I applied myself</button>
      </div>
      <p className="hint">Sent today: {sentToday} of {cap}. Kinviva never sends without this click, never sends the same application twice, and sends only by email.</p>
    </div>
  );
}
