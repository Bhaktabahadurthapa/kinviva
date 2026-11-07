import { useState } from "react";
import { api, errorText } from "../../lib/api";
import { planToText, type TroubleshootPlan } from "../../lib/incident";
import { latestGuard } from "../../lib/latest";
import { saveToNotes } from "../../lib/notes";

const guard = latestGuard();
const RISK = { low: "Low risk", medium: "Medium risk", high: "High risk" } as const;

/** A safe plan: causes are hypotheses, commands are read-only and never run by Kinviva. */
export function TroubleshootTool({ onError, onSaved, onToIncident }: { onError: (m: string) => void; onSaved: () => void; onToIncident: (plan: TroubleshootPlan, symptom: string) => void }) {
  const [symptom, setSymptom] = useState("");
  const [plan, setPlan] = useState<TroubleshootPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);

  const run = async () => {
    const mine = guard.next();
    setBusy(true);
    setPlan(null);
    try {
      const raw = await api.studioGenerate(crypto.randomUUID(), "troubleshoot", symptom.trim());
      if (guard.isCurrent(mine)) setPlan(JSON.parse(raw) as TroubleshootPlan);
    } catch (e) {
      if (guard.isCurrent(mine)) onError(errorText(e));
    } finally {
      if (guard.isCurrent(mine)) setBusy(false);
    }
  };
  const copy = async (i: number, cmd: string) => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(i);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      onError("Could not copy. Select the command and copy it yourself.");
    }
  };

  return (
    <div className="tc-tool">
      <p className="banner banner-info">Kinviva only suggests read-only checks and <strong>never runs a command</strong>. Review each command, then run it yourself.</p>
      <label className="tc-label" htmlFor="tc-symptom">What is going wrong?</label>
      <textarea id="tc-symptom" value={symptom} onChange={(e) => setSymptom(e.target.value)} rows={4} maxLength={4000} placeholder="For example: pods in the payments namespace restart every few minutes since the last deploy." />
      <div className="tc-actions">
        <button className="btn btn-primary" onClick={() => void run()} disabled={busy || symptom.trim().length < 8}>{busy ? "Building the plan…" : "Build a troubleshooting plan"}</button>
      </div>
      {plan && (
        <div className="tc-result tc-plan">
          {plan.summary && <p><strong>{plan.summary}</strong></p>}
          <h3>Possible causes <span className="tc-chip">hypotheses, not confirmed</span></h3>
          <ul>{plan.possible_causes.map((c, i) => <li key={i}><strong>{c.cause}</strong> <span className={`tc-chip tc-${c.likelihood}`}>{c.likelihood}</span><br /><span className="hint">{c.why}</span></li>)}</ul>
          {plan.evidence_to_collect.length > 0 && (<><h3>Evidence to collect</h3><ul>{plan.evidence_to_collect.map((e, i) => <li key={i}>{e}</li>)}</ul></>)}
          {plan.commands.length > 0 && (
            <>
              <h3>Read-only commands</h3>
              <ul className="tc-commands">
                {plan.commands.map((c, i) => (
                  <li key={i}>
                    <div className="tc-cmd"><code>{c.command}</code><button className="btn btn-sm" onClick={() => void copy(i, c.command)}>{copied === i ? "Copied" : "Copy"}</button></div>
                    <span className="hint">{c.purpose}{c.expect ? ` Expect: ${c.expect}` : ""} <span className={`tc-chip tc-${c.risk}`}>{RISK[c.risk]}</span></span>
                  </li>
                ))}
              </ul>
              {plan.removed_unsafe_commands > 0 && <p className="hint">{plan.removed_unsafe_commands} suggested command{plan.removed_unsafe_commands > 1 ? "s were" : " was"} removed because {plan.removed_unsafe_commands > 1 ? "they" : "it"} could change something.</p>}
            </>
          )}
          {plan.verification.length > 0 && (<><h3>How to verify a fix</h3><ul>{plan.verification.map((e, i) => <li key={i}>{e}</li>)}</ul></>)}
          {plan.unknowns.length > 0 && (<><h3>Still unknown</h3><ul>{plan.unknowns.map((e, i) => <li key={i}>{e}</li>)}</ul></>)}
          <div className="tc-actions">
            <button className="btn btn-sm" onClick={() => void saveToNotes(planToText(plan), { title: `Plan: ${symptom.trim().slice(0, 60)}` }).then(onSaved)}>Save to notes</button>
            <button className="btn btn-sm" onClick={() => onToIncident(plan, symptom.trim())}>Track as incident</button>
          </div>
        </div>
      )}
    </div>
  );
}
