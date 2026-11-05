import { evidenceNote, type ArchModel } from "../../lib/architecture";

const KIND_LABEL: Record<string, string> = { bottleneck: "Bottleneck", failure_point: "Failure point", security: "Security", unknown: "Unknown" };

/** Plain-English explanation, evidence labels, concerns and the quotes behind the picture. */
export function ArchitectureExplanation({ model }: { model: ArchModel }) {
  const counts = { verified: 0, mentioned: 0, inferred: 0 };
  model.components.forEach((c) => (counts[c.evidence] += 1));
  return (
    <div className="arch-explain">
      {model.illustrative && (
        <p className="arch-illustrative" role="note">
          <strong>Illustrative diagram.</strong> The conversation gave limited detail, so parts of this picture are suggestions, not confirmed facts.
        </p>
      )}
      <h3>What this shows</h3>
      <p>{model.explanation || "No explanation was provided."}</p>
      <h3>How sure are we</h3>
      <ul className="arch-legend" aria-label="Evidence legend">
        <li><span className="dot dot-verified" aria-hidden />{counts.verified} verified by your documents</li>
        <li><span className="dot dot-mentioned" aria-hidden />{counts.mentioned} mentioned in the conversation</li>
        <li><span className="dot dot-inferred" aria-hidden />{counts.inferred} inferred (dashed, not said)</li>
      </ul>
      <p className="hint">Confidence: <strong>{model.confidence}</strong>. Dashed lines are links MeetingLens inferred.</p>
      <h3>Components</h3>
      <ul className="arch-components">
        {model.components.map((c) => (
          <li key={c.id} title={evidenceNote(c.evidence)}>
            <span className={`dot dot-${c.evidence}`} aria-hidden />
            <span>{c.label}</span>
            <span className="arch-tag">{c.evidence}</span>
          </li>
        ))}
      </ul>
      {model.concerns.length > 0 && (
        <>
          <h3>Things to watch</h3>
          <ul className="arch-concerns">
            {model.concerns.map((c, i) => (
              <li key={i}><strong>{KIND_LABEL[c.kind] ?? "Note"}:</strong> {c.text}</li>
            ))}
          </ul>
        </>
      )}
      {model.references.length > 0 && (
        <>
          <h3>From the conversation</h3>
          <ul className="arch-refs">
            {model.references.map((r, i) => (
              <li key={i}>“{r}”</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
