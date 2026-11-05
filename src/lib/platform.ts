/** Shapes shared by the platform screens (Dashboard, Notes, Whiteboard, Learning, Discover). */
export interface AppRecord {
  id: string;
  kind: "note" | "board" | "board_rev" | "chart" | "incident";
  title: string;
  body: string;
  meta?: string | null;
  meeting_id?: string | null;
  created_at?: number;
  updated_at?: number;
}

export interface LearningItem {
  id: string;
  kind: "goal" | "lesson" | "drill" | "resource";
  title: string;
  status: "todo" | "doing" | "done";
  parent_id?: string | null;
  source?: string | null;
  url?: string | null;
  detail?: string | null;
  created_at?: number;
  updated_at?: number;
  completed_at?: number | null;
}

export interface RecentSession {
  id: string;
  title: string;
  session_type: string;
  started_at: number;
  ended_at: number | null;
  segments: number;
  notes: number;
  diagrams: number;
}

export interface DashboardStats {
  sessions: number; interviews: number; notes: number; diagrams: number; whiteboards: number; charts: number; documents: number; incidents: number;
  learning_total: number; learning_done: number; learning_doing: number; saved_articles: number;
  recent: RecentSession[];
}

export interface SearchHit { kind: string; id: string; title: string; snippet: string; when: number }

export const newId = () => crypto.randomUUID();
export const greeting = (hour: number) => (hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening");
export const minutes = (start: number, end: number | null) => (end ? Math.max(1, Math.round((end - start) / 60000)) : null);
/** Percent complete from real counts; null when there is nothing to measure. */
export const percent = (done: number, total: number) => (total > 0 ? Math.round((done / total) * 100) : null);
