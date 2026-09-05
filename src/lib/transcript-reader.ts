import { readdir, stat, readFile, access } from "fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "path";
import { homedir } from "os";
import { existsSync, statSync } from "fs";
import type { StoredSession, ChatMessage, ToolCallInfo, TodoItem, ProjectInfo } from "@/lib/types";
import { displayTranscriptText } from "@/lib/transcript-text";
import { vlog } from "@/lib/verbose";

const CURSOR_PROJECTS_DIR = join(homedir(), ".cursor", "projects");

/** Cursor stores transcripts under ~/.cursor/projects/<key>/ where key is the
 * absolute workspace with separators turned into hyphens (`D:\dev\foo` → `D-dev-foo`). */
export function workspaceToProjectKey(workspace: string): string {
  return resolve(workspace)
    .replace(/\\/g, "/")
    .replace(/\/$/, "")
    .replace(":", "")
    .replace(/^\//, "")
    .replace(/\//g, "-");
}

export function workspaceToProjectKeyCandidates(workspace: string): string[] {
  const key = workspaceToProjectKey(workspace);
  const lower = key.toLowerCase();
  return lower === key ? [key] : [key, lower];
}

export function isPathInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

function projectKeyToWorkspace(key: string): string | null {
  const parts = key.split("-");
  let path = sep + parts[0];
  for (let i = 1; i < parts.length; i++) {
    const withSlash = path + sep + parts[i];
    if (existsSync(withSlash) && statSync(withSlash).isDirectory()) {
      path = withSlash;
    } else {
      path = path + "-" + parts[i];
    }
  }
  if (!existsSync(path)) return null;
  return path;
}

export async function listProjects(): Promise<ProjectInfo[]> {
  const projects: ProjectInfo[] = [];
  try {
    const entries = await readdir(CURSOR_PROJECTS_DIR);
    for (const entry of entries) {
      if (!/^[A-Z]/.test(entry)) continue;
      const transcriptsDir = join(CURSOR_PROJECTS_DIR, entry, "agent-transcripts");
      try {
        await access(transcriptsDir);
      } catch {
        continue;
      }
      const workspace = projectKeyToWorkspace(entry);
      if (!workspace) continue;
      const name = workspace.split(sep).pop() || workspace;
      projects.push({ name, path: workspace, key: entry });
    }
  } catch {
    // projects dir doesn't exist or can't be read
  }
  return projects.sort((a, b) => a.name.localeCompare(b.name));
}

async function findTranscriptsDir(workspace: string): Promise<string | null> {
  const keys = workspaceToProjectKeyCandidates(workspace);
  for (const key of keys) {
    const dir = join(CURSOR_PROJECTS_DIR, key, "agent-transcripts");
    try {
      await access(dir);
      vlog("reader", "transcripts dir found", dir);
      return dir;
    } catch {
      vlog("reader", "transcripts dir miss", dir, "workspace", workspace, "key", key);
    }
  }
  return null;
}

async function parseJsonlEntries(jsonlPath: string): Promise<Record<string, unknown>[]> {
  try {
    const content = await readFile(jsonlPath, "utf-8");
    const entries: Record<string, unknown>[] = [];
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line));
      } catch {
        continue;
      }
    }
    return entries;
  } catch {
    return [];
  }
}

async function extractFirstUserMessage(jsonlPath: string): Promise<string> {
  for (const entry of await parseJsonlEntries(jsonlPath)) {
    if (entryRole(entry) === "user") {
      const msg = entry.message as Record<string, unknown> | undefined;
      const content = msg?.content as Array<Record<string, unknown>> | undefined;
      const text: string = (content?.[0]?.text as string) || "";
      return displayTranscriptText(text).slice(0, 120);
    }
  }
  return "";
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function findJsonlFile(entryPath: string, entryName: string): Promise<string | null> {
  const s = await stat(entryPath);

  if (s.isFile() && entryName.endsWith(".jsonl")) {
    return entryPath;
  }

  if (s.isDirectory()) {
    const inner = join(entryPath, entryName + ".jsonl");
    if (await pathExists(inner)) return inner;

    try {
      const files = (await readdir(entryPath)).filter((f) => f.endsWith(".jsonl"));
      if (files.length > 0) return join(entryPath, files[0]);
    } catch {
      // read error
    }
  }

  return null;
}

export async function readCursorSessions(workspace: string): Promise<StoredSession[]> {
  const dir = await findTranscriptsDir(workspace);
  if (!dir) return [];

  const sessions: StoredSession[] = [];

  try {
    const entries = await readdir(dir);

    for (const entry of entries) {
      const entryPath = join(dir, entry);
      const jsonl = await findJsonlFile(entryPath, entry.replace(".jsonl", ""));
      if (!jsonl) continue;

      const s = await stat(jsonl);
      const sessionId = entry.replace(".jsonl", "");
      const preview = await extractFirstUserMessage(jsonl);

      if (!preview) continue;

      sessions.push({
        id: sessionId,
        title: preview.slice(0, 60),
        workspace,
        preview,
        createdAt: s.birthtimeMs,
        updatedAt: s.mtimeMs,
      });
    }
  } catch {
    // directory read error
  }

  return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}

function entryRole(entry: Record<string, unknown>): string {
  if (typeof entry.role === "string") return entry.role;
  if (typeof entry.type === "string") return entry.type;
  const msg = entry.message as Record<string, unknown> | undefined;
  if (msg && typeof msg.role === "string") return msg.role;
  return "";
}

function textFromContentParts(contentArr: unknown[]): string {
  const textParts: string[] = [];
  for (const part of contentArr) {
    if (typeof part !== "object" || part === null) continue;
    const p = part as Record<string, unknown>;
    if (p.type === "text" && typeof p.text === "string") {
      textParts.push(p.text);
    } else if (p.type === "thinking" && typeof (p.thinking ?? p.text) === "string") {
      textParts.push(String(p.thinking ?? p.text));
    }
  }
  return textParts.join("");
}

function extractEventText(entry: Record<string, unknown>): string {
  if (typeof entry.text === "string") return entry.text;
  if (typeof entry.delta === "string") return entry.delta;
  const msg = entry.message as Record<string, unknown> | undefined;
  if (!msg) return "";
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) return textFromContentParts(msg.content);
  return "";
}

export interface SessionHistoryResult {
  messages: ChatMessage[];
  toolCalls: ToolCallInfo[];
  modifiedAt: number;
}

export async function resolveJsonlPath(workspace: string, sessionId: string): Promise<string | null> {
  const dir = await findTranscriptsDir(workspace);
  if (!dir) {
    vlog("reader", "resolveJsonlPath: no transcripts dir", { workspace, sessionId });
    return null;
  }

  const resolvedDir = resolve(dir);
  const entryPath = resolve(dir, sessionId);
  if (!isPathInside(resolvedDir, entryPath)) {
    vlog("reader", "resolveJsonlPath: path traversal blocked", { entryPath, resolvedDir });
    return null;
  }

  const flatPath = join(dir, sessionId + ".jsonl");

  if (await pathExists(entryPath)) {
    const s = await stat(entryPath);
    if (s.isDirectory()) {
      const result = await findJsonlFile(entryPath, sessionId);
      vlog("reader", "resolveJsonlPath: directory entry", { sessionId, found: result ?? "null" });
      return result;
    }
  }
  if (await pathExists(flatPath)) {
    vlog("reader", "resolveJsonlPath: flat file", { sessionId, path: flatPath });
    return flatPath;
  }
  vlog("reader", "resolveJsonlPath: not found", { sessionId, triedDir: entryPath, triedFlat: flatPath });
  return null;
}

export async function getSessionModifiedAt(workspace: string, sessionId: string): Promise<number> {
  const jsonlPath = await resolveJsonlPath(workspace, sessionId);
  if (!jsonlPath) return 0;
  try {
    return (await stat(jsonlPath)).mtimeMs;
  } catch {
    return 0;
  }
}

const TOOL_NAME_MAP: Record<string, ToolCallInfo["type"]> = {
  Read: "read",
  Write: "write",
  Edit: "edit",
  StrReplace: "edit",
  Shell: "shell",
  Grep: "search",
  Glob: "search",
  List: "read",
  TodoWrite: "todo",
};

function extractToolCallsFromContent(
  contentArr: unknown[],
  sessionId: string,
  counter: { n: number },
  baseTimestamp: number,
): ToolCallInfo[] {
  const calls: ToolCallInfo[] = [];
  for (const part of contentArr) {
    if (typeof part !== "object" || part === null) continue;
    const p = part as Record<string, unknown>;
    if (p.type !== "tool_use") continue;

    const name = (p.name as string) || "Tool";
    const input = (p.input as Record<string, unknown>) || {};
    const type = TOOL_NAME_MAP[name] || "other";

    let todos: TodoItem[] | undefined;
    if (name === "TodoWrite" && Array.isArray(input.todos)) {
      todos = (input.todos as Record<string, string>[]).map((t) => ({
        id: t.id,
        content: t.content,
        status: t.status?.toUpperCase().includes("COMPLETED")
          ? "TODO_STATUS_COMPLETED"
          : t.status?.toUpperCase().includes("PROGRESS")
            ? "TODO_STATUS_IN_PROGRESS"
            : "TODO_STATUS_PENDING",
      }));
    }

    const done = todos?.filter((t) => t.status.includes("COMPLETED")).length ?? 0;
    const total = todos?.length ?? 0;

    let toolDiff: string | undefined;
    let toolDiffStartLine: number | undefined;
    if (type === "edit" && typeof input.old_string === "string" && typeof input.new_string === "string") {
      const oldLines = (input.old_string as string).split("\n").map((l) => `-${l}`);
      const newLines = (input.new_string as string).split("\n").map((l) => `+${l}`);
      toolDiff = [...oldLines, ...newLines].join("\n");
    } else if (type === "write" && typeof input.contents === "string") {
      const lines = (input.contents as string).split("\n");
      toolDiff = lines.map((l) => `+${l}`).join("\n");
      if (lines.length > 30) {
        toolDiff = lines.slice(0, 30).map((l) => `+${l}`).join("\n") + "\n+... (" + (lines.length - 30) + " more lines)";
      }
    }
    if (typeof input.start_line === "number") {
      toolDiffStartLine = input.start_line as number;
    }

    calls.push({
      id: `${sessionId}-tc-${counter.n++}`,
      callId: `${sessionId}-tc-${counter.n}`,
      type,
      name,
      path: (input.path || input.file_path) as string | undefined,
      command:
        type === "shell"
          ? (input.command as string)
          : type === "search"
            ? (input.pattern as string)
            : undefined,
      status: "completed",
      diff: toolDiff,
      diffStartLine: toolDiffStartLine,
      result: type === "todo" && total > 0 ? `${total} items · ${done} done` : undefined,
      todos,
      timestamp: baseTimestamp + counter.n,
    });
  }
  return calls;
}

/** Stream-json often repeats a growing snapshot, not a delta. Concatenating those doubles the reply. */
export function foldSameRoleText(existing: string, incoming: string): string {
  if (incoming.startsWith(existing)) return incoming;
  if (existing.startsWith(incoming)) return existing;
  const a = existing.trimEnd();
  const b = incoming.trimEnd();
  if (b.startsWith(a)) return incoming;
  if (a.startsWith(b)) return existing;
  if (a === b) return incoming.length >= existing.length ? incoming : existing;
  return existing + incoming;
}

export function parseLiveEvents(
  events: Record<string, unknown>[],
  sessionId: string,
): { messages: ChatMessage[]; toolCalls: ToolCallInfo[] } {
  const messages: ChatMessage[] = [];
  const toolCalls: ToolCallInfo[] = [];
  const counter = { n: 0 };
  const baseTimestamp = Date.now() - 60_000;

  for (const event of events) {
    const role = entryRole(event);
    if (role !== "user" && role !== "assistant" && role !== "thinking") continue;

    const text = displayTranscriptText(extractEventText(event));

    const contentArr = (event.message as Record<string, unknown> | undefined)?.content;
    const prev = messages[messages.length - 1];

    if (role === "thinking") {
      if (!text.trim()) continue;
      if (prev && prev.id.endsWith("-thinking")) {
        prev.content = foldSameRoleText(prev.content, text);
      } else if (!prev || prev.role !== "assistant") {
        messages.push({
          id: `${sessionId}-live-thinking`,
          role: "assistant",
          content: text,
          timestamp: baseTimestamp + counter.n,
        });
      }
      continue;
    }

    if (text.trim()) {
      if (role === "assistant" && prev && prev.id.endsWith("-thinking")) {
        prev.id = `${sessionId}-live-${counter.n++}`;
        prev.content = text;
      } else if (prev && prev.role === role) {
        prev.content = foldSameRoleText(prev.content, text);
      } else {
        messages.push({
          id: `${sessionId}-live-${counter.n++}`,
          role: role as "user" | "assistant",
          content: text,
          timestamp: baseTimestamp + counter.n,
        });
      }
    }

    if (role === "assistant" && Array.isArray(contentArr)) {
      toolCalls.push(...extractToolCallsFromContent(contentArr, sessionId, counter, baseTimestamp));
    }
  }

  return { messages, toolCalls };
}

export async function readSessionMessages(workspace: string, sessionId: string): Promise<SessionHistoryResult> {
  const t0 = Date.now();
  const jsonlPath = await resolveJsonlPath(workspace, sessionId);
  if (!jsonlPath) {
    vlog("reader", "readSessionMessages: no jsonl path", { workspace, sessionId });
    return { messages: [], toolCalls: [], modifiedAt: 0 };
  }

  let modifiedAt = 0;
  try {
    modifiedAt = (await stat(jsonlPath)).mtimeMs;
  } catch (err) {
    vlog("reader", "readSessionMessages: stat failed", { jsonlPath, error: String(err) });
    return { messages: [], toolCalls: [], modifiedAt: 0 };
  }

  const entries = await parseJsonlEntries(jsonlPath);
  vlog("reader", "readSessionMessages: parsed jsonl", { sessionId, entries: entries.length, jsonlPath });

  const messages: ChatMessage[] = [];
  const toolCalls: ToolCallInfo[] = [];
  const counter = { n: 0 };
  const baseTimestamp = modifiedAt - 60_000;
  let skippedEntries = 0;

  for (const entry of entries) {
    const role = entryRole(entry);
    if (role !== "user" && role !== "assistant") {
      skippedEntries++;
      continue;
    }

    const contentArr = (entry.message as Record<string, unknown> | undefined)?.content;
    const text = displayTranscriptText(extractEventText(entry));
    if (!text.trim() && !Array.isArray(contentArr)) {
      skippedEntries++;
      continue;
    }

    if (text.trim()) {
      const prev = messages[messages.length - 1];
      if (prev && prev.role === role) {
        prev.content = foldSameRoleText(prev.content, text);
      } else {
        messages.push({
          id: `${sessionId}-${counter.n++}`,
          role: role as "user" | "assistant",
          content: text,
          timestamp: baseTimestamp + counter.n,
        });
      }
    }

    if (role === "assistant" && Array.isArray(contentArr)) {
      toolCalls.push(...extractToolCallsFromContent(contentArr, sessionId, counter, baseTimestamp));
    }
  }

  vlog("reader", "readSessionMessages: done", {
    sessionId, messages: messages.length, toolCalls: toolCalls.length,
    skippedEntries, modifiedAt, ms: Date.now() - t0,
  });

  return { messages, toolCalls, modifiedAt };
}
