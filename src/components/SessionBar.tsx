import { useState } from "react";
import { api, errorText } from "../lib/api";
import { KIND_LABEL, type SessionChoice } from "../lib/session";
import type { Course, SessionKind } from "../lib/types";

const KINDS: SessionKind[] = ["class", "work", "general"];
const HINT: Record<SessionKind, string> = {
  class: "Answers combine MeetingLens with your saved course resources and cite file and page.",
  work: "Same as General for now. Work-specific help comes later.",
  general: "Uses your general library (Resources → General library).",
};

/** Session type, course and week for the next meeting. Locked while a meeting runs. */
export function SessionBar({
  value,
  courses,
  locked,
  onChange,
  onCoursesChanged,
  onError,
}: {
  value: SessionChoice;
  courses: Course[];
  locked: boolean;
  onChange: (s: SessionChoice) => void;
  onCoursesChanged: () => void;
  onError: (m: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  const create = async () => {
    try {
      const c = await api.createCourse(name);
      setName("");
      setAdding(false);
      onCoursesChanged();
      onChange({ ...value, courseId: c.id });
    } catch (e) {
      onError(errorText(e));
    }
  };

  return (
    <div className="session-bar" aria-label="Session type">
      <div className="seg" role="group" aria-label="Session type">
        <span className="seg-label">Session</span>
        {KINDS.map((k) => (
          <button key={k} className={value.kind === k ? "active" : ""} aria-pressed={value.kind === k} disabled={locked} title={HINT[k]} onClick={() => onChange({ ...value, kind: k })}>
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      {value.kind === "class" && (
        <>
          <select className="select-sm" aria-label="Course" disabled={locked} value={value.courseId ?? ""} onChange={(e) => onChange({ ...value, courseId: e.target.value || null })}>
            <option value="">{courses.length ? "Choose a course…" : "No courses yet"}</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code ? `${c.code} · ` : ""}{c.name}
              </option>
            ))}
          </select>
          <select className="select-sm" aria-label="Week" disabled={locked} value={value.week ?? ""} onChange={(e) => onChange({ ...value, week: e.target.value ? Number(e.target.value) : null })}>
            <option value="">All weeks</option>
            {Array.from({ length: 16 }, (_, i) => i + 1).map((w) => (
              <option key={w} value={w}>Week {w}</option>
            ))}
          </select>
          {!locked && !adding && <button className="btn btn-ghost btn-sm" onClick={() => setAdding(true)}>New course</button>}
          {adding && (
            <form className="session-new" onSubmit={(e) => { e.preventDefault(); void create(); }}>
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Course name" aria-label="New course name" />
              <button className="btn btn-sm" type="submit" disabled={!name.trim()}>Add</button>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => setAdding(false)}>Cancel</button>
            </form>
          )}
        </>
      )}
      <span className="session-hint">{HINT[value.kind]}</span>
    </div>
  );
}
