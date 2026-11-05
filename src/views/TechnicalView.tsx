import { lazy, Suspense, useState } from "react";
import { ExplainTool } from "../components/technical/ExplainTool";
import { IncidentTool } from "../components/technical/IncidentTool";
import { TroubleshootTool } from "../components/technical/TroubleshootTool";
import type { TroubleshootPlan } from "../lib/incident";
import type { LiveState } from "../lib/liveReducer";

const ArchitecturePanel = lazy(() => import("../components/architecture/ArchitecturePanel").then((m) => ({ default: m.ArchitecturePanel })));
export type TechSub = "explain" | "troubleshoot" | "architecture" | "incidents";
const SUBS: [TechSub, string][] = [["explain", "Explain"], ["troubleshoot", "Troubleshoot"], ["architecture", "Architecture"], ["incidents", "Incidents"]];

/** Technical Copilot: explain, troubleshoot safely, draw the architecture, track the incident. */
export function TechnicalView({ live, onError, sub, onSub, onChanged }: { live: LiveState; onError: (m: string) => void; sub: TechSub; onSub: (s: TechSub) => void; onChanged: () => void }) {
  const [seed, setSeed] = useState<{ title: string; hypotheses: string[]; evidence: string[] } | null>(null);
  const [archSeen, setArchSeen] = useState(sub === "architecture");
  if (sub === "architecture" && !archSeen) setArchSeen(true);
  const toIncident = (plan: TroubleshootPlan, symptom: string) => {
    setSeed({ title: symptom.slice(0, 80) || "New incident", hypotheses: plan.possible_causes.map((c) => c.cause), evidence: [] });
    onSub("incidents");
  };
  return (
    <div className="tc">
      <nav className="subnav tc-tabs" role="tablist" aria-label="Technical Copilot">
        <div className="subnav-tabs">
          {SUBS.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={sub === id} className={sub === id ? "active" : ""} onClick={() => onSub(id)}>{label}</button>
          ))}
        </div>
      </nav>
      <div className="tc-body">
        {sub === "explain" && <ExplainTool live={live} onError={onError} onSaved={onChanged} />}
        {sub === "troubleshoot" && <TroubleshootTool onError={onError} onSaved={onChanged} onToIncident={toIncident} />}
        {sub === "incidents" && <IncidentTool onError={onError} onChanged={onChanged} seed={seed} />}
        {archSeen && (
          <div hidden={sub !== "architecture"} className="arch-host">
            <Suspense fallback={<p className="hint arch-loading">Loading the diagram tools…</p>}>
              <ArchitecturePanel live={live} onError={onError} />
            </Suspense>
          </div>
        )}
      </div>
    </div>
  );
}
