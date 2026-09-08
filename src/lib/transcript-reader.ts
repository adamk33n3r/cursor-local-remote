import { readdir, stat, readFile, access } from "fs/promises";
import { isAbsolute, join, relative, resolve } from "path";
import { homedir } from "os";
import type { StoredSession, ChatMessage, ToolCallInfo, TodoItem } from "@/lib/types";
import { readToolCallEvents } from "@/lib/tool-call-events";
import { displayTranscriptText } from "@/lib/transcript-text";
import { vlog } from "@/lib/verbose";

const MAX_TOOL_OUTPUT_CHARS = 100_000;

const CURSOR_PROJECTS_DIR = join(homedir(), ".cursor", "projects");

/** Cursor stores transcripts under ~/.cursor/projects/<key>/ where key is the
 * absolute workspace with separators turned into hyphens (`D:\dev\foo` → `d-dev-foo`). */
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

export { listCursorCacheWorkspaces, projectKeyToWorkspace } from "@/lib/cursor-project-cache.mjs";

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

const STREAM_TOOL_KEYS: Record<string, { type: ToolCallInfo["type"]; name: string }> = {
  readToolCall: { type: "read", name: "Read" },
  writeToolCall: { type: "write", name: "Write" },
  editToolCall: { type: "edit", name: "Edit" },
  shellToolCall: { type: "shell", name: "Shell" },
  grepToolCall: { type: "search", name: "Grep" },
  globToolCall: { type: "search", name: "Glob" },
  lsToolCall: { type: "read", name: "List" },
  listToolCall: { type: "read", name: "List" },
  todoToolCall: { type: "todo", name: "TodoWrite" },
};

function truncateToolOutput(text: string): string {
  if (text.length <= MAX_TOOL_OUTPUT_CHARS) return text;
  const extra = text.length - MAX_TOOL_OUTPUT_CHARS;
  return `${text.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n... (${extra} more characters)`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function formatErrorResult(error: unknown): string {
  if (typeof error === "string") return error;
  const rec = asRecord(error);
  if (!rec) return String(error);
  if (typeof rec.clientVisibleErrorMessage === "string") return rec.clientVisibleErrorMessage;
  if (typeof rec.message === "string") return rec.message;
  return JSON.stringify(error);
}

function lineCountLabel(text: string): string | undefined {
  const lines = text.split("\n").filter((line) => line.length > 0).length;
  if (lines === 0) return undefined;
  return `${lines} line${lines === 1 ? "" : "s"}`;
}

function toolMatchKey(tc: ToolCallInfo): string {
  if (tc.type === "shell") return `shell:${tc.command ?? ""}`;
  if (tc.type === "search") return `search:${tc.command ?? ""}:${tc.path ?? ""}`;
  if (tc.path) return `${tc.type}:${tc.path}`;
  if (tc.type === "todo") return "todo";
  return `${tc.type}:${tc.name}`;
}

function parseStreamToolCall(
  event: Record<string, unknown>,
  sessionId: string,
  timestamp: number,
): ToolCallInfo | null {
  if (event.type !== "tool_call") return null;
  const callId = typeof event.call_id === "string" && event.call_id
    ? event.call_id
    : `${sessionId}-stream-tc`;
  const blob = asRecord(event.tool_call);
  if (!blob) return null;

  let type: ToolCallInfo["type"] = "other";
  let name = "Tool";
  let payload: Record<string, unknown> = {};

  if (asRecord(blob.function)) {
    const fn = asRecord(blob.function)!;
    name = typeof fn.name === "string" ? fn.name : "Tool";
    type = TOOL_NAME_MAP[name] || "other";
    if (typeof fn.arguments === "string") {
      try {
        payload = { args: JSON.parse(fn.arguments) as Record<string, unknown> };
      } catch {
        payload = { args: { command: fn.arguments } };
      }
    } else {
      payload = { args: asRecord(fn.arguments) ?? {}, result: fn.result };
    }
  } else {
    const key = Object.keys(blob)[0];
    if (!key) return null;
    const mapped = STREAM_TOOL_KEYS[key];
    type = mapped?.type ?? "other";
    name = mapped?.name ?? key;
    payload = asRecord(blob[key]) ?? {};
  }

  const args = asRecord(payload.args) ?? {};
  const resultWrap = asRecord(payload.result);
  const success = resultWrap ? asRecord(resultWrap.success) : null;

  let status: ToolCallInfo["status"] = event.subtype === "completed" ? "completed" : "running";
  if (event.subtype === "completed" && resultWrap && resultWrap.error) status = "error";

  let command: string | undefined;
  if (type === "shell" && typeof args.command === "string") command = args.command;
  else if (type === "search" && typeof args.pattern === "string") command = args.pattern;

  let path = (args.path || args.file_path) as string | undefined;
  let output: string | undefined;
  let result: string | undefined;
  let diff: string | undefined;
  let todos: TodoItem[] | undefined;

  if (resultWrap?.error) {
    output = truncateToolOutput(formatErrorResult(resultWrap.error));
    result = "error";
  } else if (success) {
    if (type === "shell") {
      if (typeof success.command === "string") command = success.command;
      const stdout = typeof success.stdout === "string" ? success.stdout : "";
      const stderr = typeof success.stderr === "string" ? success.stderr : "";
      const combined = [stdout, stderr].filter((part) => part.length > 0).join("\n");
      if (combined) output = truncateToolOutput(combined);
      const code = typeof success.exitCode === "number" ? success.exitCode : 0;
      if (code !== 0) status = "error";
      const lines = output ? lineCountLabel(output) : undefined;
      result = lines ? `exit ${code} · ${lines}` : `exit ${code}`;
    } else if (typeof success.diffString === "string") {
      diff = success.diffString;
    } else if (typeof success.content === "string" && type !== "read") {
      output = truncateToolOutput(success.content);
    }
    if (typeof success.path === "string") path = success.path;
    if (type === "todo" && Array.isArray(success.todos)) {
      todos = (success.todos as Record<string, string>[]).map((t) => ({
        id: t.id,
        content: t.content,
        status: t.status,
      }));
      const done = todos.filter((t) => t.status.includes("COMPLETED")).length;
      result = `${todos.length} items · ${done} done`;
    }
  }

  return {
    id: callId,
    callId,
    type,
    name,
    path,
    command,
    status,
    result,
    output,
    diff,
    todos,
    timestamp,
  };
}

function foldStreamToolCalls(calls: ToolCallInfo[]): ToolCallInfo[] {
  const byId = new Map<string, ToolCallInfo>();
  const order: string[] = [];
  for (const tc of calls) {
    const prev = byId.get(tc.callId);
    if (!prev) {
      byId.set(tc.callId, tc);
      order.push(tc.callId);
      continue;
    }
    byId.set(tc.callId, {
      ...prev,
      ...tc,
      command: tc.command ?? prev.command,
      path: tc.path ?? prev.path,
      result: tc.result ?? prev.result,
      output: tc.output ?? prev.output,
      diff: tc.diff ?? prev.diff,
      todos: tc.todos ?? prev.todos,
      status: tc.status === "running" && prev.status !== "running" ? prev.status : tc.status,
    });
  }
  return order.map((id) => byId.get(id)!);
}

/** Copy stream-json tool output onto jsonl tool_use rows (those rows have no call ids).
 * Stream events are a suffix of the file list (plus maybe a newer in-flight call). */
export function overlayToolCallResults(
  fromFile: ToolCallInfo[],
  fromStream: ToolCallInfo[],
): ToolCallInfo[] {
  if (fromStream.length === 0) return fromFile;
  if (fromFile.length === 0) return fromStream;

  const merged = fromFile.map((tc) => ({ ...tc }));
  const unusedStream = new Set(fromStream.keys());
  const fileByKey = new Map<string, number[]>();
  for (let i = 0; i < merged.length; i++) {
    const key = toolMatchKey(merged[i]!);
    const list = fileByKey.get(key) ?? [];
    list.push(i);
    fileByKey.set(key, list);
  }
  const streamByKey = new Map<string, number[]>();
  for (let i = 0; i < fromStream.length; i++) {
    const key = toolMatchKey(fromStream[i]!);
    const list = streamByKey.get(key) ?? [];
    list.push(i);
    streamByKey.set(key, list);
  }

  for (const [key, fileIdxs] of fileByKey) {
    const streamIdxs = streamByKey.get(key) ?? [];
    if (streamIdxs.length === 0) continue;
    const n = Math.min(fileIdxs.length, streamIdxs.length);
    const fileAlign = streamIdxs.length <= fileIdxs.length
      ? fileIdxs.slice(fileIdxs.length - n)
      : fileIdxs;
    const streamAlign = streamIdxs.length <= fileIdxs.length
      ? streamIdxs
      : streamIdxs.slice(0, n);
    for (let i = 0; i < n; i++) {
      const fileTc = merged[fileAlign[i]!]!;
      const streamTc = fromStream[streamAlign[i]!]!;
      unusedStream.delete(streamAlign[i]!);
      merged[fileAlign[i]!] = {
        ...fileTc,
        status: streamTc.status,
        result: streamTc.result ?? fileTc.result,
        output: streamTc.output ?? fileTc.output,
        diff: streamTc.diff ?? fileTc.diff,
        todos: streamTc.todos ?? fileTc.todos,
        command: fileTc.command ?? streamTc.command,
        path: fileTc.path ?? streamTc.path,
      };
    }
  }

  const leftover = [...unusedStream].sort((a, b) => a - b).map((i) => fromStream[i]!);
  return [...merged, ...leftover];
}

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

  const la = compactLetters(existing);
  const lb = compactLetters(incoming);
  if (sameUtterance(la, lb)) {
    return preferFormatted(existing, incoming);
  }

  if (incoming.length < 80 && incoming.length <= existing.length) {
    if (existing.endsWith(incoming)) return existing;
    const needSpace = /\S$/.test(existing) && /^\S/.test(incoming);
    return existing + (needSpace ? " " : "") + incoming;
  }

  return existing + incoming;
}

function compactLetters(text: string): string {
  return text.replace(/[\s|*#>`_\-\[\]()]+/g, "").toLowerCase();
}

function sameUtterance(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b || a.startsWith(b) || b.startsWith(a)) return true;
  const n = Math.min(a.length, b.length);
  if (n >= 24 && (a.includes(b) || b.includes(a))) return true;
  if (n < 24) return false;
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i >= 40 || i >= n * 0.8;
}

export function mergeMessageLists(fromFile: ChatMessage[], fromLive: ChatMessage[]): ChatMessage[] {
  const messages = [...fromFile];
  const seen = new Set(fromFile.map(messageKey));

  for (const message of fromLive) {
    const key = messageKey(message);
    if (seen.has(key)) continue;
    if (messages.some((existing) => existing.role === message.role && sameUtterance(
      compactLetters(existing.content),
      compactLetters(message.content),
    ))) {
      continue;
    }
    const last = messages[messages.length - 1];
    if (
      last
      && last.role === message.role
      && sameUtterance(compactLetters(last.content), compactLetters(message.content))
    ) {
      last.content = foldSameRoleText(last.content, message.content);
      seen.add(messageKey(last));
      continue;
    }
    seen.add(key);
    messages.push(message);
  }
  return messages;
}

function messageKey(message: ChatMessage): string {
  return `${message.role}:${message.content.replace(/\s+/g, " ").trim()}`;
}

function formattingScore(text: string): number {
  let score = 0;
  for (const ch of text) {
    if (ch === "\n") score += 8;
    else if (ch === " ") score += 1;
    else if (ch === "|") score += 4;
    else if (ch === "*") score += 2;
  }
  return score;
}

function preferFormatted(existing: string, incoming: string): string {
  const existingScore = formattingScore(existing);
  const incomingScore = formattingScore(incoming);
  if (incomingScore !== existingScore) {
    return incomingScore > existingScore ? incoming : existing;
  }
  return incoming.length >= existing.length ? incoming : existing;
}

function isBufferedAssistantFlush(event: Record<string, unknown>): boolean {
  return event.timestamp_ms != null && event.model_call_id != null;
}

function isPartialAssistantDelta(event: Record<string, unknown>): boolean {
  return event.timestamp_ms != null && event.model_call_id == null;
}

export function parseLiveEvents(
  events: Record<string, unknown>[],
  sessionId: string,
): { messages: ChatMessage[]; toolCalls: ToolCallInfo[] } {
  const messages: ChatMessage[] = [];
  const fromUse: ToolCallInfo[] = [];
  const fromStream: ToolCallInfo[] = [];
  const counter = { n: 0 };
  const baseTimestamp = Date.now() - 60_000;
  let openAssistantDelta = false;

  for (const event of events) {
    const streamTc = parseStreamToolCall(event, sessionId, baseTimestamp + counter.n);
    if (streamTc) {
      fromStream.push(streamTc);
      continue;
    }

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

    if (role === "user") openAssistantDelta = false;

    if (text.trim() && !(role === "assistant" && isBufferedAssistantFlush(event))) {
      if (role === "assistant" && isPartialAssistantDelta(event)) {
        openAssistantDelta = true;
      }
      if (role === "assistant" && prev && prev.id.endsWith("-thinking")) {
        prev.id = `${sessionId}-live-${counter.n++}`;
        prev.content = text;
      } else if (prev && prev.role === role) {
        if (role === "assistant" && isPartialAssistantDelta(event)) {
          prev.content = foldSameRoleText(prev.content, text);
        } else if (role === "assistant" && openAssistantDelta) {
          prev.content = text;
          openAssistantDelta = false;
        } else if (role === "assistant" && sameUtterance(compactLetters(text), compactLetters(prev.content))) {
          prev.content = foldSameRoleText(prev.content, text);
        } else if (role === "assistant") {
          messages.push({
            id: `${sessionId}-live-${counter.n++}`,
            role: "assistant",
            content: text,
            timestamp: baseTimestamp + counter.n,
          });
        } else {
          prev.content = foldSameRoleText(prev.content, text);
        }
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
      fromUse.push(...extractToolCallsFromContent(contentArr, sessionId, counter, baseTimestamp));
    }
  }

  const streamCalls = foldStreamToolCalls(fromStream);
  const toolCalls = streamCalls.length > 0
    ? overlayToolCallResults(fromUse, streamCalls)
    : fromUse;

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

  const sidecar = parseLiveEvents(readToolCallEvents(sessionId), sessionId);
  const mergedCalls = overlayToolCallResults(toolCalls, sidecar.toolCalls);

  vlog("reader", "readSessionMessages: done", {
    sessionId, messages: messages.length, toolCalls: mergedCalls.length,
    skippedEntries, modifiedAt, ms: Date.now() - t0,
  });

  return { messages, toolCalls: mergedCalls, modifiedAt };
}
