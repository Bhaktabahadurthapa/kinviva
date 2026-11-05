import { invoke } from "@tauri-apps/api/core";
import type {
  AiAction,
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
  startMeeting: (title?: string) => invoke<MeetingStatus>("start_meeting", { title: title || null }),
  stopMeeting: () => invoke<string | null>("stop_meeting"),
  switchMic: (device: string | null) => invoke<void>("switch_mic", { device }),
  getSnapshot: () => invoke<Snapshot>("get_snapshot"),
  setLiveNotes: (notes: string) => invoke<void>("set_live_notes", { notes }),
  aiRun: (action: AiAction, question?: string) =>
    invoke<string>("ai_run", { action, question: question ?? null }),
  interviewRun: (request: InterviewRequest) => invoke<string>("interview_run", { request }),
  interviewSkills: () => invoke<SkillInfo[]>("interview_skills"),
  aiCancel: (requestId: string) => invoke<boolean>("ai_cancel", { requestId }),
  listMeetings: (search?: string) => invoke<MeetingSummary[]>("list_meetings", { search: search || null }),
  getMeeting: (id: string) => invoke<MeetingDetail>("get_meeting", { id }),
  renameMeeting: (id: string, title: string) => invoke<void>("rename_meeting", { id, title }),
  deleteMeeting: (id: string) => invoke<void>("delete_meeting", { id }),
  exportMeeting: (id: string, format: "md" | "txt", path: string) =>
    invoke<string>("export_meeting", { id, format, path }),
  loadMeetingContext: (id: string) => invoke<void>("load_meeting_context", { id }),
  createDemoMeeting: () => invoke<string>("create_demo_meeting"),
  addDocument: (path: string) => invoke<DocumentInfo>("add_document", { path }),
  listDocuments: () => invoke<DocumentInfo[]>("list_documents"),
  setDocumentActive: (id: string, active: boolean) => invoke<void>("set_document_active", { id, active }),
  deleteDocument: (id: string) => invoke<void>("delete_document", { id }),
  previewRetrieval: (text?: string) => invoke<Passage[]>("preview_retrieval", { text: text ?? null }),
  toggleOverlay: () => invoke<boolean>("toggle_overlay"),
  showMain: () => invoke<void>("show_main"),
  appInfo: () => invoke<{ version: string; data_dir: string; os: string; schema_version: number }>("app_info"),
};
