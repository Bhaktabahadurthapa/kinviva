import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { api, errorText } from "../lib/api";
import type { DocumentInfo, Passage } from "../lib/types";

export function DocumentsView({ onError, embedded }: { onError: (m: string) => void; embedded?: boolean }) {
  const [docs, setDocs] = useState<DocumentInfo[]>([]);
  const [results, setResults] = useState<{ name: string; ok: boolean; msg: string }[]>([]);
  const [probe, setProbe] = useState("");
  const [hits, setHits] = useState<Passage[] | null>(null);
  const load = () => api.listDocuments().then((all) => setDocs(all.filter((d) => !d.course_id))).catch((e) => onError(errorText(e)));
  useEffect(() => void load(), []);

  const add = async () => {
    const picked = await open({ multiple: true, filters: [{ name: "Documents", extensions: ["txt", "md", "markdown", "pdf", "docx"] }] });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    const out: typeof results = [];
    for (const p of paths) {
      const name = p.split(/[\\/]/).pop() ?? p;
      try {
        const d = await api.addDocument(p);
        out.push({ name, ok: true, msg: `${d.chunks} passages indexed (${d.chars.toLocaleString()} characters).` });
      } catch (e) {
        out.push({ name, ok: false, msg: errorText(e) });
      }
    }
    setResults(out);
    load();
  };

  return (
    <div className={embedded ? "" : "page"}>
      <header className="page-head">
        <div>
          {!embedded && <h1>Context documents</h1>}
          <p className="lead">
            Notes, a résumé or an agenda (.txt, .md, .pdf, .docx) for Work and General sessions and Interview practice. When you use an assistant action,
            Kinviva searches active documents for passages matching the recent conversation and includes up to four of them. Course files are kept separate (above).
          </p>
        </div>
        <button className="btn btn-primary" onClick={add}>
          Add files…
        </button>
      </header>
      {results.map((r, i) => (
        <div key={i} className={`banner ${r.ok ? "banner-ok" : "banner-bad"}`}>
          <strong>{r.name}:</strong> {r.msg}
        </div>
      ))}
      {docs.length === 0 ? (
        <p className="empty">No documents yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Use</th>
              <th>Name</th>
              <th>Type</th>
              <th>Passages</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={d.active}
                    aria-label={`Use ${d.name}`}
                    onChange={(e) => api.setDocumentActive(d.id, e.target.checked).then(load)}
                  />
                </td>
                <td>{d.name}</td>
                <td>{d.kind.toUpperCase()}</td>
                <td>{d.chunks}</td>
                <td>
                  <button className="btn btn-ghost btn-sm" onClick={() => api.deleteDocument(d.id).then(load)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <section className="probe">
        <h2>Test retrieval</h2>
        <form
          className="row"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              setHits(await api.previewRetrieval(probe));
            } catch (err) {
              onError(errorText(err));
            }
          }}
        >
          <input value={probe} onChange={(e) => setProbe(e.target.value)} placeholder="Type something a participant might say…" />
          <button className="btn" type="submit">
            Search
          </button>
        </form>
        {hits && hits.length === 0 && <p className="empty">No passages matched.</p>}
        {hits?.map((p, i) => (
          <blockquote key={i}>
            <cite>
              {p.page != null ? `${p.document}, p. ${p.page}` : `${p.document} #${p.chunk + 1}`}
            </cite>
            {p.text}
          </blockquote>
        ))}
      </section>
    </div>
  );
}
