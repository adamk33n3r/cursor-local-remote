export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface TodoItem {
  id: string;
  content: string;
  status: string;
}

export interface ToolCallInfo {
  id: string;
  callId: string;
  type: "read" | "write" | "edit" | "shell" | "search" | "todo" | "other";
  name: string;
  path?: string;
  command?: string;
  args?: string;
  status: "running" | "completed" | "error";
  result?: string;
  /** Full command/tool stdout (or stderr) shown when the card is expanded. */
  output?: string;
  diff?: string;
  diffStartLine?: number;
  todos?: TodoItem[];
  timestamp: number;
}

export interface StoredSession {
  id: string;
  title: string;
  workspace: string;
  preview: string;
  createdAt: number;
  updatedAt: number;
}

export type AgentMode = "agent" | "ask" | "plan";

export interface ChatRequest {
  prompt: string;
  sessionId?: string;
  model?: string;
  mode?: AgentMode;
  workspace?: string;
}

export interface NetworkInfo {
  lanIp: string;
  port: number;
  url: string;
  authUrl: string;
  workspace: string;
}

export interface QueuedMessage {
  id: string;
  content: string;
  timestamp: number;
  model?: string;
  mode?: AgentMode;
}

export interface ModelInfo {
  id: string;
  label: string;
  isDefault: boolean;
  isCurrent: boolean;
}

export interface WorkspaceInfo {
  name: string;
  path: string;
  key: string;
}

/** Virtual listing of Windows drive letters (up from C:\). Not a filesystem path. */
export const WINDOWS_DRIVES_LISTING = ":drives";

export function isWindowsDrivesListing(path: string | null | undefined): boolean {
  return path === WINDOWS_DRIVES_LISTING;
}

export type FsEntry = { name: string; path: string };

export type FsListing = {
  path: string;
  parent: string | null;
  startDirectory: string;
  entries: FsEntry[];
};

export interface TerminalInfo {
  id: string;
  cwd: string;
  running: boolean;
  exitCode: number | null;
  startedAt: number;
}
