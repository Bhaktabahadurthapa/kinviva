/** The sidebar. An item is listed only once its screen really works (`ready`). */
export type Tab =
  | "dashboard" | "meeting" | "interview" | "classroom" | "technical" | "presentation" | "whiteboard" | "discover" | "jobs"
  | "knowledge" | "notes" | "visuals" | "sessions" | "documents" | "architecture" | "settings";

export interface NavItem {
  id: Tab;
  label: string;
  group: "Main" | "Workspace";
  /** 24x24 stroke path */
  icon: string;
  ready: boolean;
  /** colour of the icon tile */
  tone: "purple" | "blue" | "green" | "amber" | "rose" | "teal";
  /** Shows the meeting controls (timer, Start, Stop) above the screen. */
  session?: boolean;
}

export const NAV: NavItem[] = [
  { id: "dashboard", label: "Dashboard", group: "Main", icon: "M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10", ready: true, tone: "purple" },
  { id: "meeting", label: "Meetings", group: "Main", icon: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3", ready: true, tone: "blue", session: true },
  { id: "interview", label: "Interviews", group: "Main", icon: "M4 5h16v10H9l-5 4zM8 9h8M8 12h5", ready: true, tone: "rose", session: true },
  { id: "classroom", label: "Classroom", group: "Main", icon: "M3 8l9-5 9 5-9 5zM7 10.5V16c0 1 2.2 3 5 3s5-2 5-3v-5.5", ready: true, tone: "green", session: true },
  { id: "technical", label: "Technical Copilot", group: "Main", icon: "M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14", ready: true, tone: "teal", session: true },
  { id: "presentation", label: "Presentation", group: "Main", icon: "M3 4h18v11H3zM12 15v5M8 20h8", ready: true, tone: "amber", session: true },
  { id: "discover", label: "Discover", group: "Main", icon: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15.5 8.5l-2 5-5 2 2-5z", ready: true, tone: "purple" },
  { id: "jobs", label: "Jobs & Resume", group: "Main", icon: "M4 8h16v11H4zM9 8V5h6v3M4 13h16", ready: true, tone: "green" },
  { id: "whiteboard", label: "Whiteboard", group: "Main", icon: "M3 5h18v12H3zM8 21h8M12 17v4M7 12l3-3 3 3 3-4", ready: true, tone: "blue" },
  { id: "knowledge", label: "Knowledge Base", group: "Workspace", icon: "M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2zM8 7h6M8 11h6", ready: true, tone: "teal" },
  { id: "notes", label: "All Notes", group: "Workspace", icon: "M5 3h14v18H5zM9 8h6M9 12h6M9 16h3", ready: true, tone: "amber" },
  { id: "visuals", label: "Visuals & Diagrams", group: "Workspace", icon: "M4 20V10M10 20V4M16 20v-7M22 20H2", ready: true, tone: "rose" },
  { id: "sessions", label: "Session history", group: "Workspace", icon: "M12 7v5l3 2M21 12a9 9 0 1 1-3-6.7M21 4v5h-5", ready: true, tone: "blue" },
  { id: "documents", label: "Documents", group: "Workspace", icon: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6", ready: true, tone: "green" },
];

export const SESSION_TABS = new Set<Tab>(NAV.filter((n) => n.session).map((n) => n.id));
export const TITLES: Record<Tab, string> = {
  dashboard: "Dashboard", meeting: "Meetings", interview: "Interviews", classroom: "Classroom", technical: "Technical Copilot", presentation: "Presentation",
  whiteboard: "Whiteboard", discover: "Discover", jobs: "Jobs & Resume", knowledge: "Knowledge Base", notes: "All Notes", visuals: "Visuals & Diagrams",
  sessions: "Session history", documents: "Documents", architecture: "Architecture", settings: "Settings",
};
