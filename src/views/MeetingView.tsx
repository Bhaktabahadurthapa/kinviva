import type { Dispatch } from "react";
import { SessionBar } from "../components/SessionBar";
import type { LiveEvent, LiveState } from "../lib/liveReducer";
import type { SessionChoice } from "../lib/session";
import type { AutoMode, Course } from "../lib/types";
import { HistoryView } from "./HistoryView";
import { LiveView } from "./LiveView";
import { ResourcesView } from "./ResourcesView";

export type MeetingTab = "live" | "history" | "resources";

const TABS: [MeetingTab, string][] = [
  ["live", "Live"],
  ["history", "History"],
  ["resources", "Resources"],
];

/** The Meeting area: session type on top, then Live, History and Resources. */
export function MeetingView({
  tab,
  onTab,
  live,
  dispatch,
  onError,
  autoMode,
  onAutoChange,
  session,
  onSession,
  courses,
  onCoursesChanged,
  running,
  historyKey,
}: {
  tab: MeetingTab;
  onTab: (t: MeetingTab) => void;
  live: LiveState;
  dispatch: Dispatch<LiveEvent>;
  onError: (m: string) => void;
  autoMode: AutoMode;
  onAutoChange: (m: AutoMode) => void;
  session: SessionChoice;
  onSession: (s: SessionChoice) => void;
  courses: Course[];
  onCoursesChanged: () => void;
  running: boolean;
  historyKey: number;
}) {
  const active = running ? live.status?.session : undefined;
  return (
    <div className="meeting-area">
      <div className="subnav">
        <div className="subnav-tabs" role="tablist" aria-label="Meeting sections">
          {TABS.map(([t, label]) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "active" : ""} onClick={() => onTab(t)}>
              {label}
            </button>
          ))}
        </div>
        {tab === "live" && (
          <SessionBar value={session} courses={courses} locked={running} onChange={onSession} onCoursesChanged={onCoursesChanged} onError={onError} />
        )}
      </div>
      {active?.kind === "class" && (
        <div className="banner banner-ok session-banner">
          Class session · {active.course_name}
          {active.week ? ` · Week ${active.week}` : " · all weeks"}. Answers cite your course files by name and page.
        </div>
      )}
      <div className="meeting-body">
        {tab === "live" && <LiveView live={live} dispatch={dispatch} onError={onError} autoMode={autoMode} onAutoChange={onAutoChange} />}
        {tab === "history" && <HistoryView onError={onError} onOpenLive={() => onTab("live")} refreshKey={historyKey} />}
        {tab === "resources" && <ResourcesView courses={courses} onCoursesChanged={onCoursesChanged} onError={onError} />}
      </div>
    </div>
  );
}
