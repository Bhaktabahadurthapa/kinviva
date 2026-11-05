export type Source = "mic" | "system";

export interface Segment {
  id: number;
  source: Source;
  text: string;
  start_ms: number;
  end_ms: number;
}

export interface Transcript {
  finals: Segment[];
  partials: Partial<Record<Source, string>>;
}

export interface SourceStatus {
  enabled: boolean;
  capture: "off" | "starting" | "capturing" | "error";
  stt: "idle" | "connecting" | "connected" | "error" | "closed";
  device: string | null;
  message: string | null;
}

export interface MeetingStatus {
  state: "idle" | "starting" | "running" | "stopping";
  meeting_id: string | null;
  title: string | null;
  started_at: number | null;
  mic: SourceStatus;
  system: SourceStatus;
  stt_provider: string;
  audio_to_cloud: boolean;
  stt_host: string | null;
  recording_audio: boolean;
  context_meeting_id: string | null;
  context_is_demo: boolean;
}

export interface Passage {
  document: string;
  chunk: number;
  text: string;
}

export type AutoMode = "off" | "explain" | "explain_reply";

export type AiAction = "ask" | "explain" | "suggest" | "recap";
export type Slot = "meaning" | "reply";

export interface AiSlot {
  request_id: string | null;
  action: AiAction | null;
  state: "idle" | "streaming" | "done" | "error" | "cancelled";
  text: string;
  error: string | null;
  sources: Passage[];
  destination: string | null;
  question: string | null;
  auto: boolean;
  segment_id: number | null;
}

export interface AiEvent extends AiSlot {
  slot: Slot;
}

export interface Snapshot {
  status: MeetingStatus;
  transcript: Transcript;
  notes: string;
  ai: Partial<Record<Slot, AiSlot>>;
}

export interface Shortcuts {
  toggle_meeting: string;
  toggle_overlay: string;
  suggest_reply: string;
  explain: string;
}

export interface Settings {
  onboarded: boolean;
  capture_mic: boolean;
  capture_system: boolean;
  mic_device: string | null;
  save_audio: boolean;
  stt_provider: "deepgram" | "whisper_cli" | "whisper_native";
  deepgram_model: string;
  deepgram_endpoint: string;
  language: string;
  whisper_cli_path: string;
  whisper_model_path: string;
  llm_base_url: string;
  llm_model: string;
  llm_use_api_key: boolean;
  llm_temperature: number;
  llm_reasoning: "auto" | "off" | "minimal" | "low" | "medium" | "high";
  context_chars: number;
  use_documents: boolean;
  question_detection: boolean;
  question_cooldown_secs: number;
  auto_assist: AutoMode;
  auto_min_words: number;
  overlay_content_protection: boolean;
  shortcuts: Shortcuts;
}

export interface MeetingSummary {
  id: string;
  title: string;
  started_at: number;
  ended_at: number | null;
  segment_count: number;
  is_demo: boolean;
}

export interface AiMessage {
  id: string;
  action: AiAction;
  question: string | null;
  response: string;
  model: string;
  status: string;
  created_at: number;
}

export interface MeetingDetail {
  meeting: MeetingSummary;
  notes: string;
  segments: Segment[];
  ai_messages: AiMessage[];
}

export interface DocumentInfo {
  id: string;
  name: string;
  kind: string;
  chars: number;
  chunks: number;
  active: boolean;
  created_at: number;
}

export interface DeviceInfo {
  name: string;
  is_default: boolean;
}

// ---- Interview Practice ----
export type InterviewCategory = "cloud_devops" | "system_design" | "ai_engineering" | "coding";
export type InterviewMode = "explain" | "practice";
export type InterviewLanguage = "python" | "java" | "cpp";

export interface InterviewRequest {
  category: InterviewCategory;
  mode: InterviewMode;
  question: string;
  answer?: string | null;
  language?: InterviewLanguage | null;
}

export type InterviewParsed =
  | { kind: "answer"; say_it: string; understand_it: string; code: string | null; tradeoffs: string[]; follow_up: string }
  | {
      kind: "feedback";
      correctness: string;
      missing_points: string[];
      structure: string;
      clarity: string;
      coaching_score: number | null;
      improved_say_it: string;
      follow_up: string;
    };

export interface InterviewEvent {
  request_id: string;
  category: InterviewCategory;
  mode: InterviewMode;
  skill: string;
  state: "streaming" | "done" | "error" | "cancelled";
  received_chars: number;
  result: InterviewParsed | null;
  fallback_text: string | null;
  error: string | null;
}

export interface SkillInfo {
  category: InterviewCategory;
  name: string;
  description: string | null;
  error: string | null;
}
