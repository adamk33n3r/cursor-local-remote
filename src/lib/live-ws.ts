import { watch, type FSWatcher } from "fs";
import type { IncomingMessage, Server, ServerResponse } from "http";
import type { Duplex } from "stream";
import { WebSocket, WebSocketServer } from "ws";
import {
  FILE_POLL_MS,
  LIVE_DEBOUNCE_MS,
  PROCESS_EXIT_SETTLE_MS,
  WS_KEEPALIVE_MS,
} from "@/lib/constants";
import {
  getLiveEvents,
  isActive,
  onLiveUpdate,
  onProcessExit,
} from "@/lib/process-registry";
import {
  getTerminal,
  getTerminalOutput,
  listTerminals,
  onTerminalListChange,
  onTerminalOutput,
  writeToTerminal,
} from "@/lib/terminal-registry";
import {
  getSessionModifiedAt,
  foldSameRoleText,
  parseLiveEvents,
  readSessionMessages,
  resolveJsonlPath,
} from "@/lib/transcript-reader";
import type { ChatMessage, ToolCallInfo } from "@/lib/types";
import { sessionIdParam } from "@/lib/validation";
import { vlog } from "@/lib/verbose";
import { getWorkspace } from "@/lib/workspace";

export const LIVE_WATCH_PATH = "/api/sessions/watch";
export const LIVE_TERMINAL_PATH = "/api/terminal/stream";
export const LIVE_TERMINAL_LIST_PATH = "/api/terminal/list";

function liveKind(url: string | undefined): "watch" | "terminal" | "terminal-list" | null {
  const pathname = livePathname(url);
  if (pathname === LIVE_WATCH_PATH) return "watch";
  if (pathname === LIVE_TERMINAL_PATH) return "terminal";
  if (pathname === LIVE_TERMINAL_LIST_PATH) return "terminal-list";
  return null;
}

const COOKIE_NAME = "cr_session";

type AttachLiveWebSockets = (
  server: Server,
  fallbackUpgrade?: (req: IncomingMessage, socket: Duplex, head: Buffer) => void,
) => void;

declare global {
  // eslint-disable-next-line no-var
  var __attachLiveWebSockets: AttachLiveWebSockets | undefined;
  // eslint-disable-next-line no-var
  var __handleLiveHttpRequest: typeof handleLiveHttpRequest | undefined;
}

function livePathname(url: string | undefined): string {
  return new URL(url ?? "/", "http://localhost").pathname;
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) return part.slice(idx + 1).trim();
  }
  return undefined;
}

function isAuthorized(req: IncomingMessage): boolean {
  const token = process.env.AUTH_TOKEN?.toLowerCase();
  if (!token) return true;

  const url = new URL(req.url ?? "/", "http://localhost");
  const queryToken = url.searchParams.get("token");
  if (queryToken?.toLowerCase() === token) return true;

  const cookie = cookieValue(req.headers.cookie, COOKIE_NAME);
  if (cookie?.toLowerCase() === token) return true;

  const auth = req.headers.authorization;
  if (auth?.toLowerCase() === `bearer ${token}`) return true;

  return false;
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

function sendEvent(ws: WebSocket, event: string, data: unknown): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ event, data }));
}

function messageKey(message: ChatMessage): string {
  return `${message.role}:${message.content.replace(/\s+/g, " ").trim()}`;
}

function mergeTranscript(
  fromFile: { messages: ChatMessage[]; toolCalls: ToolCallInfo[] },
  fromLive: { messages: ChatMessage[]; toolCalls: ToolCallInfo[] },
): { messages: ChatMessage[]; toolCalls: ToolCallInfo[] } {
  const seen = new Set(fromFile.messages.map(messageKey));
  const messages = [...fromFile.messages];
  for (const message of fromLive.messages) {
    const key = messageKey(message);
    if (seen.has(key)) continue;
    const last = messages[messages.length - 1];
    if (last && last.role === message.role) {
      last.content = foldSameRoleText(last.content, message.content);
      seen.add(messageKey(last));
      continue;
    }
    seen.add(key);
    messages.push(message);
  }
  const toolSeen = new Set(fromFile.toolCalls.map((t) => t.id));
  const toolCalls = [...fromFile.toolCalls];
  for (const call of fromLive.toolCalls) {
    if (toolSeen.has(call.id)) continue;
    toolSeen.add(call.id);
    toolCalls.push(call);
  }
  return { messages, toolCalls };
}

export function handleLiveHttpRequest(req: IncomingMessage, res: ServerResponse): boolean {
  if (!liveKind(req.url)) return false;
  res.writeHead(426, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "WebSocket required" }));
  return true;
}

async function attachWatchSocket(ws: WebSocket, req: IncomingMessage): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const rawId = url.searchParams.get("id");
  const result = sessionIdParam.safeParse(rawId);
  if (!result.success) {
    vlog("watch", "invalid session id", rawId);
    ws.close(1008, "invalid or missing session id");
    return;
  }
  const sessionId = result.data;
  const workspace = url.searchParams.get("workspace") || getWorkspace();
  let jsonlPath = await resolveJsonlPath(workspace, sessionId);
  const active = isActive(sessionId);

  vlog("watch", "WebSocket connect", { sessionId, workspace, jsonlPath: jsonlPath ?? "null", isActive: active });

  if (!jsonlPath && !active) {
    console.warn(`[watch] ${sessionId} not found (no jsonl, not active) workspace=${workspace}`);
    vlog("watch", "session not found — no jsonl and not active", sessionId);
    ws.close(1008, "session not found");
    return;
  }

  let watcher: FSWatcher | null = null;
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let filePollTimer: ReturnType<typeof setInterval> | null = null;
  let liveDebounce: ReturnType<typeof setTimeout> | null = null;
  let unsubExit: (() => void) | null = null;
  let unsubLive: (() => void) | null = null;
  let lastSentModified = 0;
  let cancelled = false;

  function cleanup(): void {
    cancelled = true;
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    if (liveDebounce) { clearTimeout(liveDebounce); liveDebounce = null; }
    if (filePollTimer) { clearInterval(filePollTimer); filePollTimer = null; }
    if (unsubExit) { unsubExit(); unsubExit = null; }
    if (unsubLive) { unsubLive(); unsubLive = null; }
    if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null; }
    if (watcher) { watcher.close(); watcher = null; }
  }

  function startFileWatcher(path: string, pushUpdate: () => Promise<void>): void {
    try {
      vlog("watch", "starting file watcher", path);
      watcher = watch(path, () => {
        if (cancelled) return;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => void pushUpdate(), LIVE_DEBOUNCE_MS);
      });
      watcher.on("error", (err) => {
        vlog("watch", "file watcher error", sessionId, String(err));
        cleanup();
        ws.close();
      });
    } catch (err) {
      vlog("watch", "file watcher setup failed", sessionId, String(err));
    }
  }

  const pushFileUpdate = async () => {
    if (cancelled || !jsonlPath) return;
    try {
      const modifiedAt = await getSessionModifiedAt(workspace, sessionId);
      if (modifiedAt <= lastSentModified) {
        vlog("watch", "skipping file update — not modified", { sessionId, modifiedAt, lastSentModified });
        return;
      }

      const fromFile = await readSessionMessages(workspace, sessionId);
      const live = parseLiveEvents(getLiveEvents(sessionId), sessionId);
      const merged = mergeTranscript(fromFile, live);
      lastSentModified = modifiedAt;
      vlog("watch", "pushing file update", { sessionId, messages: merged.messages.length, toolCalls: merged.toolCalls.length, modifiedAt });
      sendEvent(ws, "update", { messages: merged.messages, toolCalls: merged.toolCalls, modifiedAt: Math.max(modifiedAt, Date.now()), isActive: isActive(sessionId) });
    } catch (err) {
      vlog("watch", "pushFileUpdate error", sessionId, String(err));
    }
  };

  const pushLiveSnapshot = async () => {
    if (cancelled) return;
    const live = parseLiveEvents(getLiveEvents(sessionId), sessionId);
    const fromFile = jsonlPath
      ? await readSessionMessages(workspace, sessionId)
      : { messages: [], toolCalls: [], modifiedAt: 0 };
    const merged = mergeTranscript(fromFile, live);
    const modifiedAt = Math.max(fromFile.modifiedAt, Date.now());
    if (fromFile.modifiedAt > lastSentModified) lastSentModified = fromFile.modifiedAt;
    vlog("watch", "pushing live snapshot", {
      sessionId,
      fileMessages: fromFile.messages.length,
      liveMessages: live.messages.length,
      merged: merged.messages.length,
    });
    sendEvent(ws, "update", {
      messages: merged.messages,
      toolCalls: merged.toolCalls,
      modifiedAt,
      isActive: isActive(sessionId),
    });
  };

  unsubLive = onLiveUpdate(sessionId, () => {
    if (cancelled) return;
    if (liveDebounce) clearTimeout(liveDebounce);
    liveDebounce = setTimeout(() => {
      liveDebounce = null;
      void pushLiveSnapshot();
    }, LIVE_DEBOUNCE_MS);
  });

  if (jsonlPath) {
    const fromFile = await readSessionMessages(workspace, sessionId);
    const live = parseLiveEvents(getLiveEvents(sessionId), sessionId);
    const merged = mergeTranscript(fromFile, live);
    lastSentModified = fromFile.modifiedAt;
    vlog("watch", "sending connected (file+live)", {
      sessionId,
      fileMessages: fromFile.messages.length,
      liveMessages: live.messages.length,
      merged: merged.messages.length,
      modifiedAt: fromFile.modifiedAt,
      isActive: isActive(sessionId),
    });
    sendEvent(ws, "connected", {
      messages: merged.messages,
      toolCalls: merged.toolCalls,
      modifiedAt: Math.max(fromFile.modifiedAt, Date.now()),
      isActive: isActive(sessionId),
    });
    startFileWatcher(jsonlPath, pushFileUpdate);
  } else {
    const events = getLiveEvents(sessionId);
    const { messages, toolCalls } = parseLiveEvents(events, sessionId);
    vlog("watch", "sending connected (live)", { sessionId, liveEvents: events.length, messages: messages.length, toolCalls: toolCalls.length });
    sendEvent(ws, "connected", { messages, toolCalls, modifiedAt: Date.now(), isActive: isActive(sessionId) });

    filePollTimer = setInterval(() => {
      void (async () => {
        if (cancelled) return;
        const path = await resolveJsonlPath(workspace, sessionId);
        if (!path) return;
        vlog("watch", "jsonl file appeared during poll, adding file watcher", { sessionId, path });
        jsonlPath = path;
        if (filePollTimer) { clearInterval(filePollTimer); filePollTimer = null; }
        startFileWatcher(path, pushFileUpdate);
        void pushFileUpdate();
      })();
    }, FILE_POLL_MS);
    filePollTimer.unref();
  }

  unsubExit = onProcessExit(sessionId, () => {
    void (async () => {
      if (cancelled) return;
      vlog("watch", "process exit detected", sessionId);
      await new Promise((r) => setTimeout(r, PROCESS_EXIT_SETTLE_MS));
      try {
        const { messages, toolCalls, modifiedAt } = await readSessionMessages(workspace, sessionId);
        if (modifiedAt > lastSentModified) lastSentModified = modifiedAt;
        vlog("watch", "sending final update after exit", { sessionId, messages: messages.length, toolCalls: toolCalls.length, modifiedAt });
        sendEvent(ws, "update", { messages, toolCalls, modifiedAt, isActive: false });
      } catch (err) {
        vlog("watch", "exit read failed, falling back to live events", sessionId, String(err));
        const events = getLiveEvents(sessionId);
        const parsed = parseLiveEvents(events, sessionId);
        sendEvent(ws, "update", { messages: parsed.messages, toolCalls: parsed.toolCalls, modifiedAt: Date.now(), isActive: false });
      }
    })();
  });

  keepaliveTimer = setInterval(() => {
    if (cancelled) return;
    if (ws.readyState !== WebSocket.OPEN) {
      cleanup();
      return;
    }
    ws.ping();
  }, WS_KEEPALIVE_MS);
  keepaliveTimer.unref();

  ws.on("close", () => {
    vlog("watch", "WebSocket closed", sessionId);
    cleanup();
  });
  ws.on("error", (err) => {
    vlog("watch", "WebSocket error", sessionId, String(err));
    cleanup();
  });
}

type TerminalClientMessage = { type: "input"; data: string };

function parseTerminalClientMessage(raw: string): TerminalClientMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    vlog("terminal", "invalid JSON from Client", String(err));
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  if (!("type" in parsed) || !("data" in parsed)) return null;
  const rec = parsed as { type: unknown; data: unknown };
  if (rec.type !== "input" || typeof rec.data !== "string") return null;
  return { type: "input", data: rec.data };
}

function attachTerminalSocket(ws: WebSocket, req: IncomingMessage): void {
  const url = new URL(req.url ?? "/", "http://localhost");
  const id = url.searchParams.get("id");
  if (!id) {
    ws.close(1008, "id is required");
    return;
  }

  const term = getTerminal(id);
  if (!term) {
    ws.close(1008, "terminal not found");
    return;
  }

  console.warn(`[terminal] ${id} Client connected`);

  let cancelled = false;
  let unsub: (() => void) | null = null;
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  let lastSentLength = 0;

  function cleanup(): void {
    cancelled = true;
    if (unsub) { unsub(); unsub = null; }
    if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null; }
  }

  const output = getTerminalOutput(id);
  lastSentLength = output.length;
  sendEvent(ws, "connected", {
    output,
    running: term.running,
    exitCode: term.exitCode,
  });

  unsub = onTerminalOutput(id, () => {
    if (cancelled) return;
    const current = getTerminalOutput(id);
    const newData = current.slice(lastSentLength);
    lastSentLength = current.length;
    const t = getTerminal(id);
    sendEvent(ws, "output", {
      data: newData,
      running: t?.running ?? false,
      exitCode: t?.exitCode ?? null,
    });
  });

  keepaliveTimer = setInterval(() => {
    if (cancelled) return;
    if (ws.readyState !== WebSocket.OPEN) {
      cleanup();
      return;
    }
    ws.ping();
  }, WS_KEEPALIVE_MS);
  keepaliveTimer.unref();

  ws.on("message", (raw) => {
    const preview = String(raw).slice(0, 200);
    const msg = parseTerminalClientMessage(String(raw));
    if (!msg) {
      console.warn(`[terminal] ${id} dropped stdin (not type:input JSON): ${preview}`);
      return;
    }
    const ok = writeToTerminal(id, msg.data);
    console.warn(
      `[terminal] ${id} stdin ok=${ok} running=${Boolean(getTerminal(id)?.running)} bytes=${msg.data.length} ${JSON.stringify(msg.data.slice(0, 80))}`,
    );
  });
  ws.on("close", cleanup);
  ws.on("error", (err) => {
    vlog("terminal", "WebSocket error", id, String(err));
    cleanup();
  });
}

function attachTerminalListSocket(ws: WebSocket): void {
  let cancelled = false;
  let unsub: (() => void) | null = null;
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  function cleanup(): void {
    cancelled = true;
    if (unsub) { unsub(); unsub = null; }
    if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null; }
  }

  function push(event: "connected" | "update"): void {
    sendEvent(ws, event, { terminals: listTerminals() });
  }

  push("connected");
  unsub = onTerminalListChange(() => {
    if (cancelled) return;
    push("update");
  });

  keepaliveTimer = setInterval(() => {
    if (cancelled) return;
    if (ws.readyState !== WebSocket.OPEN) {
      cleanup();
      return;
    }
    ws.ping();
  }, WS_KEEPALIVE_MS);
  keepaliveTimer.unref();

  ws.on("close", cleanup);
  ws.on("error", (err) => {
    vlog("terminal-list", "WebSocket error", String(err));
    cleanup();
  });
}

function trackLiveSocket(liveSockets: Set<WebSocket>, ws: WebSocket): void {
  liveSockets.add(ws);
  ws.on("close", () => liveSockets.delete(ws));
}

export function attachLiveWebSockets(
  server: Server,
  fallbackUpgrade?: (req: IncomingMessage, socket: Duplex, head: Buffer) => void,
): void {
  const wss = new WebSocketServer({ noServer: true });
  const liveSockets = new Set<WebSocket>();
  server.on("close", () => {
    for (const ws of liveSockets) ws.terminate();
    wss.close();
  });

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const pathname = livePathname(req.url);
    const kind = liveKind(req.url);
    console.warn(`[upgrade] ${req.url ?? pathname}`);
    if (!kind) {
      if (fallbackUpgrade) {
        fallbackUpgrade(req, socket, head);
        return;
      }
      socket.destroy();
      return;
    }

    if (!isAuthorized(req)) {
      console.warn(`[upgrade] ${kind} 401`);
      rejectUpgrade(socket, 401, "Unauthorized");
      return;
    }

    if (kind === "watch") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        trackLiveSocket(liveSockets, ws);
        void attachWatchSocket(ws, req);
      });
      return;
    }
    if (kind === "terminal") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        trackLiveSocket(liveSockets, ws);
        attachTerminalSocket(ws, req);
      });
      return;
    }
    if (kind === "terminal-list") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        trackLiveSocket(liveSockets, ws);
        attachTerminalListSocket(ws);
      });
      return;
    }
    const _never: never = kind;
    return _never;
  };

  server.prependListener("upgrade", onUpgrade);

  const rawOn = server.on.bind(server);
  const rawAddListener = server.addListener.bind(server);
  const rawPrepend = server.prependListener.bind(server);
  const ignoreForeignUpgrade = (
    original: typeof rawOn,
    event: string | symbol,
    listener: (...args: unknown[]) => void,
  ) => {
    if (event === "upgrade" && listener !== onUpgrade) {
      console.warn("[upgrade] blocked extra listener");
      return server;
    }
    return original(event, listener);
  };
  server.on = ((event: string | symbol, listener: (...args: unknown[]) => void) =>
    ignoreForeignUpgrade(rawOn, event, listener)) as typeof server.on;
  server.addListener = ((event: string | symbol, listener: (...args: unknown[]) => void) =>
    ignoreForeignUpgrade(rawAddListener, event, listener)) as typeof server.addListener;
  server.prependListener = ((event: string | symbol, listener: (...args: unknown[]) => void) => {
    if (event === "upgrade" && listener !== onUpgrade) {
      console.warn("[upgrade] blocked extra prepend listener");
      return server;
    }
    return rawPrepend(event, listener);
  }) as typeof server.prependListener;
}

globalThis.__attachLiveWebSockets = attachLiveWebSockets;
globalThis.__handleLiveHttpRequest = handleLiveHttpRequest;
