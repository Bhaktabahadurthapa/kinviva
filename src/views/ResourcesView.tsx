import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { api, errorText } from "../lib/api";
import type { Course, DocumentInfo } from "../lib/types";
import { DocumentsView } from "./DocumentsView";

const WEEKS = Array.from({ length: 16 }, (_, i) => i + 1);

function CourseCard({ course, docs, onChanged, onError }: { course: Course; docs: DocumentInfo[]; onChanged: () => void; onError: (m: string) => void }) {
  const [week, setWeek] = useState<number | "">(1);
  const [msgs, setMsgs] = useState<{ name: string; ok: boolean; msg: string }[]>([]);
  const mine = docs.filter((d) => d.course_id === course.id);
  const byWeek = new Map<number | null, DocumentInfo[]>();
  for (const d of mine) byWeek.set(d.week ?? null, [...(byWeek.get(d.week ?? null) ?? []), d]);
  const weeks = [...byWeek.keys()].sort((a, b) => (a ?? 999) - (b ?? 999));

  const add = async () => {
    const picked = await open({ multiple: true, filters: [{ name: "Course resources", extensions: ["txt", "md", "markdown", "pdf"] }] });
    if (!picked) return;
    const out: typeof msgs = [];
    for (const p of Array.isArray(picked) ? picked : [picked]) {
      const name = p.split(/[\\/]/).pop() ?? p;
      try {
        const d = await api.addDocument(p, course.id, week === "" ? null : week);
        out.push({ name, ok: true, msg: `${d.chunks} passages indexed${d.kind === "pdf" ? " with page numbers" : ""}.` });
      } catch (e) {
        out.push({ name, ok: false, msg: errorText(e) });
      }
    }
    setMsgs(out);
    onChanged();
  };

  return (
    <section className="card course-card">
      <header className="course-head">
        <div>
          <h2>{course.name}</h2>
          <p className="hint">{[course.code, course.term].filter(Boolean).join(" · ") || "Saved course"} · {mine.length} resource{mine.length === 1 ? "" : "s"}</p>
        </div>
        <div className="course-add">
          <select className="select-sm" aria-label={`Week for new files in ${course.name}`} value={week} onChange={(e) => setWeek(e.target.value ? Number(e.target.value) : "")}>
            {WEEKS.map((w) => <option key={w} value={w}>Week {w}</option>)}
            <option value="">No week (whole course)</option>
          </select>
          <button className="btn btn-primary btn-sm" onClick={add}>Add files…</button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              if (window.confirm(`Delete "${course.name}" and its ${mine.length} resource(s)? Saved meetings keep their transcripts.`)) {
                api.deleteCourse(course.id).then(onChanged).catch((e) => onError(errorText(e)));
              }
            }}
          >
            Delete course
          </button>
        </div>
      </header>
      {msgs.map((r, i) => (
        <div key={i} className={`banner ${r.ok ? "banner-ok" : "banner-bad"}`}><strong>{r.name}:</strong> {r.msg}</div>
      ))}
      {mine.length === 0 && <p className="empty">No resources yet. Pick a week and add slides, readings or notes (.pdf, .md, .txt).</p>}
      {weeks.map((w) => (
        <div key={String(w)} className="week-group">
          <h3>{w == null ? "Whole course" : `Week ${w}`}</h3>
          {byWeek.get(w)!.map((d) => (
            <div key={d.id} className="week-row">
              <label>
                <input type="checkbox" checked={d.active} aria-label={`Use ${d.name}`} onChange={(e) => api.setDocumentActive(d.id, e.target.checked).then(onChanged)} />
                {d.name}
              </label>
              <span className="hint">{d.kind.toUpperCase()} · {d.chunks} passages</span>
              <button className="btn btn-ghost btn-sm" onClick={() => api.deleteDocument(d.id).then(onChanged)}>Remove</button>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

/** Saved courses with weekly resources, then the general library used by Work and General sessions. */
export function ResourcesView({ courses, onCoursesChanged, onError }: { courses: Course[]; onCoursesChanged: () => void; onError: (m: string) => void }) {
  const [docs, setDocs] = useState<DocumentInfo[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const load = () => api.listDocuments().then(setDocs).catch((e) => onError(errorText(e)));
  useEffect(() => void load(), []);
  const changed = () => {
    void load();
    onCoursesChanged();
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Courses</h1>
          <p className="lead">
            Save each course once, then add its resources week by week. In a Class session, answers use only that course's files and cite the file and page.
            Scanned PDFs without text cannot be read.
          </p>
        </div>
      </header>
      <form
        className="row course-new"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api.createCourse(name, code);
            setName("");
            setCode("");
            changed();
          } catch (err) {
            onError(errorText(err));
          }
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Course name, e.g. Operating Systems" aria-label="Course name" />
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code (optional)" aria-label="Course code" style={{ maxWidth: 160 }} />
        <button className="btn btn-primary" type="submit" disabled={!name.trim()}>Save course</button>
      </form>
      {courses.length === 0 && <p className="empty">No courses yet.</p>}
      {courses.map((c) => <CourseCard key={c.id} course={c} docs={docs} onChanged={changed} onError={onError} />)}
      <h1 className="library-title">General library</h1>
      <DocumentsView onError={onError} embedded />
    </div>
  );
}
