/** The sidebar. An item is listed only once its screen really works (`ready`). */
export type Tab =
  | "dashboard" | "meeting" | "interview" | "classroom" | "technical" | "presentation" | "whiteboard" | "discover" | "learning"
  | "knowledge" | "notes" | "visuals" | "sessions" | "documents" | "architecture" | "settings";

export interface NavItem {
  id: Tab;
  label: string;
  group: "Main" | "Workspace";
  /** 24x24 stroke path */
  icon: string;
  ready: boolean;
  /** Shows the meeting controls (timer, Start, Stop) above the screen. */
  session?: boolean;
}

export const NAV: NavItem[] = [
  { id: "dashboard", label: "Dashboard", group: "Main", icon: "M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10", ready: true },
  { id: "meeting", label: "Meetings", group: "Main", icon: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3", ready: true, session: true },
  { id: "interview", label: "Interviews", group: "Main", icon: "M4 5h16v10H9l-5 4zM8 9h8M8 12h5", ready: true, session: true },
  { id: "architecture", label: "Architecture", group: "Main", icon: "M4 4h6v5H4zM14 4h6v5h-6zM9 15h6v5H9zM7 9v3h10V9M12 12v3", ready: true, session: true },
  { id: "knowledge", label: "Knowledge Base", group: "Workspace", icon: "M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2zM8 7h6M8 11h6", ready: true },
  { id: "notes", label: "All Notes", group: "Workspace", icon: "M5 3h14v18H5zM9 8h6M9 12h6M9 16h3", ready: true },
  { id: "sessions", label: "Session history", group: "Workspace", icon: "M12 7v5l3 2M21 12a9 9 0 1 1-3-6.7M21 4v5h-5", ready: true },
  { id: "documents", label: "Documents", group: "Workspace", icon: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6", ready: true },
];

export const SESSION_TABS = new Set<Tab>(NAV.filter((n) => n.session).map((n) => n.id));
export const TITLES: Record<Tab, string> = {
  dashboard: "Dashboard", meeting: "Meetings", interview: "Interviews", classroom: "Classroom", technical: "Technical Copilot", presentation: "Presentation",
  whiteboard: "Whiteboard", discover: "Discover", learning: "My Learning", knowledge: "Knowledge Base", notes: "All Notes", visuals: "Visuals & Diagrams",
  sessions: "Session history", documents: "Documents", architecture: "Architecture", settings: "Settings",
};
