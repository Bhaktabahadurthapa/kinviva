import type { JobsReport } from "./jobs";
import type { ResumeDoc } from "./resume";
import { invoke } from "@tauri-apps/api/core";
import type {
  AiAction,
  Course,
  SessionKind,
  DeviceInfo,
  DocumentInfo,
  InterviewRequest,
  MeetingDetail,
  MeetingStatus,
  MeetingSummary,
  Passage,
  Settings,
  SkillInfo,
  Snapshot,
} from "./types";
import type { ArchModel, DiagramRecord } from "./architecture";
import type { AppRecord, DashboardStats, DiscoverItem, LearningItem, SearchHit, TopicScore, Trend } from "./platform";

/** True when running inside the Tauri shell (not a plain browser preview). */
export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return JSON.stringify(e);
}

export const api = {
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<{ shortcut_errors: string[] }>("save_settings", { settings }),
  listInputDevices: () => invoke<DeviceInfo[]>("list_input_devices"),
  speechEngines: () => invoke<{ native_available: boolean }>("speech_engines"),
  setSecret: (name: string, value: string) => invoke<void>("set_secret", { name, value }),
  deleteSecret: (name: string) => invoke<void>("delete_secret", { name }),
  secretStatus: () => invoke<Record<string, boolean>>("secret_status"),
  listModels: (baseUrl: string, useApiKey: boolean) =>
    invoke<string[]>("list_models", { baseUrl, useApiKey }),
  startMeeting: (title?: string, session?: { kind: SessionKind; courseId?: string | null; week?: number | null }) =>
    invoke<MeetingStatus>("start_meeting", {
      title: title || null,
      sessionType: session?.kind ?? "general",
      courseId: session?.kind === "class" ? session.courseId ?? null : null,
      week: session?.kind === "class" ? session.week ?? null : null,
    }),
  stopMeeting: () => invoke<string | null>("stop_meeting"),
  setInterviewLive: (active: boolean) => invoke<void>("set_interview_live", { active }),
  screenRead: () => invoke<string>("screen_read"),
  setPaused: (paused: boolean) => invoke<void>("set_paused", { paused }),
  switchMic: (device: string | null) => invoke<void>("switch_mic", { device }),
  getSnapshot: () => invoke<Snapshot>("get_snapshot"),
  setLiveNotes: (notes: string) => invoke<void>("set_live_notes", { notes }),
  aiRun: (action: AiAction, question?: string) =>
    invoke<string>("ai_run", { action, question: question ?? null }),
  interviewRun: (request: InterviewRequest) => invoke<string>("interview_run", { request }),
  architectureGenerate: (requestId: string, hint?: string) => invoke<ArchModel>("architecture_generate", { requestId, hint: hint || null }),
  architectureSave: (diagram: DiagramRecord) => invoke<void>("architecture_save", { diagram }),
  architectureList: (meetingId?: string | null) => invoke<DiagramRecord[]>("architecture_list", { meetingId: meetingId ?? null }),
  architectureDelete: (id: string) => invoke<void>("architecture_delete", { id }),
  videoOpen: (url: string, fullPage: boolean, x: number, y: number, w: number, h: number) => invoke<string>("video_open", { url, fullPage, x, y, w, h }),
  videoBounds: (x: number, y: number, w: number, h: number) => invoke<void>("video_bounds", { x, y, w, h }),
  videoInfo: (url: string) => invoke<{ title: string; channel: string } | null>("video_info", { url }),
  videoVisible: (visible: boolean) => invoke<void>("video_visible", { visible }),
  editionInfo: () => invoke<{ edition: string; label: string }>("edition_info"),
  instructionsPreview: (screen: string) => invoke<string>("instructions_preview", { screen }),
  clipboardText: () => invoke<string>("clipboard_text"),
  videoInBrowser: (url: string) => invoke<void>("video_in_browser", { url }),
  videoClose: () => invoke<void>("video_close"),
  architectureWriteFile: (path: string, dataBase64: string) => invoke<void>("architecture_write_file", { path, dataBase64 }),
  studioGenerate: (requestId: string, kind: string, input?: string, meetingId?: string | null) =>
    invoke<string>("studio_generate", { requestId, kind, input: input ?? null, meetingId: meetingId ?? null }),
  recordSave: (record: AppRecord) => invoke<AppRecord>("record_save", { record }),
  recordList: (kind: string, search?: string, meetingId?: string | null, withBody = true) =>
    invoke<AppRecord[]>("record_list", { kind, search: search || null, meetingId: meetingId ?? null, withBody }),
  recordGet: (id: string) => invoke<AppRecord | null>("record_get", { id }),
  recordDelete: (id: string) => invoke<void>("record_delete", { id }),
  boardSnapshot: (boardId: string, label: string, scene: string) => invoke<void>("board_snapshot", { boardId, label, scene }),
  boardRevisions: (boardId: string) => invoke<AppRecord[]>("board_revisions", { boardId }),
  learningList: () => invoke<LearningItem[]>("learning_list"),
  learningSave: (item: LearningItem) => invoke<LearningItem>("learning_save", { item }),
  learningDelete: (id: string) => invoke<void>("learning_delete", { id }),
  quizRecord: (topic: string, total: number, correct: number) => invoke<void>("quiz_record", { topic, total, correct }),
  quizStats: () => invoke<{ attempts: number; total: number; correct: number }>("quiz_stats"),
  dashboardStats: () => invoke<DashboardStats>("dashboard_stats"),
  globalSearch: (query: string) => invoke<SearchHit[]>("global_search", { query }),
  discoverRefresh: () => invoke<{ added: number; pictures?: number; failed: string[] }>("discover_refresh"),
  discoverList: (kind?: string, savedOnly = false) => invoke<[DiscoverItem[], number | null]>("discover_list", { kind: kind ?? null, savedOnly }),
  discoverMark: (id: string, field: "read" | "saved", value: boolean) => invoke<void>("discover_mark", { id, field, value }),
  discoverTrends: () => invoke<Trend[]>("discover_trends"),
  openLink: (url: string) => invoke<void>("open_link", { url }),
  resumeRead: (path: string) => invoke<string>("resume_read", { path }),
  jobsSearch: (query: { categories: string[]; keywords: string; remote_only: boolean; boards: string[] }) => invoke<JobsReport>("jobs_search", { query }),
  jobsTailor: (requestId: string, resume: string, title: string, company: string, description: string) =>
    invoke<[string, string[]]>("jobs_tailor", { requestId, resume, title, company, description }),
  jobsCoverLetter: (requestId: string, resume: string, title: string, company: string, description: string) =>
    invoke<string>("jobs_cover_letter", { requestId, resume, title, company, description }),
  letterExport: (text: string, heading: string, format: "docx" | "txt", path: string) => invoke<string>("letter_export", { text, heading, format, path }),
  resumeExport: (doc: ResumeDoc, template: string, format: "docx" | "txt", path: string) => invoke<string>("resume_export", { doc, template, format, path }),
  resumeReformat: (requestId: string, resume: string) => invoke<string>("resume_reformat", { requestId, resume }),
  openExternal: (url: string) => invoke<void>("open_external", { url }),
  quizTopics: () => invoke<TopicScore[]>("quiz_topics"),
  interviewSkills: () => invoke<SkillInfo[]>("interview_skills"),
  aiCancel: (requestId: string) => invoke<boolean>("ai_cancel", { requestId }),
  listMeetings: (search?: string) => invoke<MeetingSummary[]>("list_meetings", { search: search || null }),
  getMeeting: (id: string) => invoke<MeetingDetail>("get_meeting", { id }),
  renameMeeting: (id: string, title: string) => invoke<void>("rename_meeting", { id, title }),
  listTrash: () => invoke<MeetingSummary[]>("list_trash"),
  trashMeetings: (ids: string[]) => invoke<number>("trash_meetings", { ids }),
  restoreMeetings: (ids: string[]) => invoke<number>("restore_meetings", { ids }),
  purgeMeetings: (ids: string[], withLinked: boolean) => invoke<number>("purge_meetings", { ids, withLinked }),
  emptyTrash: (withLinked: boolean) => invoke<number>("empty_trash", { withLinked }),
  deleteMeeting: (id: string) => invoke<void>("delete_meeting", { id }),
  exportMeeting: (id: string, format: "md" | "txt" | "docx", path: string) =>
    invoke<string>("export_meeting", { id, format, path }),
  exportInterview: (format: "md" | "txt" | "docx", path: string, sinceMs?: number | null) =>
    invoke<string>("export_interview", { format, path, sinceMs: sinceMs ?? null }),
  interviewSavedCount: (sinceMs?: number | null) => invoke<number>("interview_saved_count", { sinceMs: sinceMs ?? null }),
  clearInterviewEntries: (sinceMs?: number | null) => invoke<void>("clear_interview_entries", { sinceMs: sinceMs ?? null }),
  loadMeetingContext: (id: string) => invoke<void>("load_meeting_context", { id }),
  createDemoMeeting: () => invoke<string>("create_demo_meeting"),
  addDocument: (path: string, courseId?: string | null, week?: number | null) =>
    invoke<DocumentInfo>("add_document", { path, courseId: courseId ?? null, week: week ?? null }),
  listCourses: () => invoke<Course[]>("list_courses"),
  createCourse: (name: string, code?: string, term?: string) => invoke<Course>("create_course", { name, code: code || null, term: term || null }),
  deleteCourse: (id: string) => invoke<void>("delete_course", { id }),
  listDocuments: () => invoke<DocumentInfo[]>("list_documents"),
  setDocumentActive: (id: string, active: boolean) => invoke<void>("set_document_active", { id, active }),
  deleteDocument: (id: string) => invoke<void>("delete_document", { id }),
  previewRetrieval: (text?: string) => invoke<Passage[]>("preview_retrieval", { text: text ?? null }),
  toggleOverlay: () => invoke<boolean>("toggle_overlay"),
  showMain: () => invoke<void>("show_main"),
  appInfo: () => invoke<{ version: string; data_dir: string; os: string; schema_version: number }>("app_info"),
};
