import type { ChildProcess } from "child_process";
import { LIVE_EVENT_TTL_MS } from "@/lib/constants";
import { appendToolCallEvent } from "@/lib/tool-call-events";

type ProcessExitHook = (sessionId: string, workspace: string) => void;

interface RunningProcess {
  child: ChildProcess;
  sessionId: string | null;
  mapKey: string;
  workspace: string;
  startedAt: number;
}

interface ProcessRegistryState {
  processes: Map<string, RunningProcess>;
  exitListeners: Map<string, Set<() => void>>;
  liveEvents: Map<string, Record<string, unknown>[]>;
  liveListeners: Map<string, Set<() => void>>;
  globalExitHook: ProcessExitHook | null;
}

declare global {
  // Next HMR and the Host upgrade handler can load this module twice.
  // eslint-disable-next-line no-var
  var __processRegistry: ProcessRegistryState | undefined;
}

const state: ProcessRegistryState = globalThis.__processRegistry ?? (globalThis.__processRegistry = {
  processes: new Map(),
  exitListeners: new Map(),
  liveEvents: new Map(),
  liveListeners: new Map(),
  globalExitHook: null,
});

const processes = state.processes;
const exitListeners = state.exitListeners;
const liveEvents = state.liveEvents;
const liveListeners = state.liveListeners;

export function setProcessExitHook(hook: ProcessExitHook): void {
  state.globalExitHook = hook;
}

export function pushLiveEvent(sessionId: string, event: Record<string, unknown>): void {
  let events = liveEvents.get(sessionId);
  if (!events) {
    events = [];
    liveEvents.set(sessionId, events);
  }
  events.push(event);

  const listeners = liveListeners.get(sessionId);
  if (listeners) {
    for (const cb of listeners) cb();
  }
}

export function getLiveEvents(sessionId: string): Record<string, unknown>[] {
  return liveEvents.get(sessionId) ?? [];
}

export function onLiveUpdate(sessionId: string, cb: () => void): () => void {
  let set = liveListeners.get(sessionId);
  if (!set) {
    set = new Set();
    liveListeners.set(sessionId, set);
  }
  const captured = set;
  captured.add(cb);
  return () => { captured.delete(cb); };
}

function isLiveTranscriptEvent(event: Record<string, unknown>): boolean {
  const type = event.type;
  return type === "user" || type === "assistant" || type === "thinking" || type === "tool_call";
}

function attachStdoutLiveFeed(entry: RunningProcess): void {
  let buffer = "";
  entry.child.stdout?.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    const sid = entry.sessionId ?? entry.mapKey;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const event = JSON.parse(trimmed) as Record<string, unknown>;
        if (isLiveTranscriptEvent(event)) {
          pushLiveEvent(sid, event);
          if (event.type === "tool_call") {
            const persistId = typeof event.session_id === "string" && event.session_id
              ? event.session_id
              : sid;
            try {
              appendToolCallEvent(persistId, event);
            } catch {
              // disk full / permission — still keep the live event
            }
          }
        }
      } catch {
        // non-json line
      }
    }
  });
}

export function registerProcess(
  requestId: string,
  child: ChildProcess,
  workspace: string,
): void {
  const entry: RunningProcess = {
    child,
    sessionId: null,
    mapKey: requestId,
    workspace,
    startedAt: Date.now(),
  };
  processes.set(requestId, entry);
  attachStdoutLiveFeed(entry);

  const onExit = () => {
    const sid = entry.sessionId ?? entry.mapKey;
    processes.delete(entry.mapKey);
    const listeners = exitListeners.get(entry.mapKey);
    if (listeners) {
      exitListeners.delete(entry.mapKey);
      for (const cb of listeners) cb();
    }
    if (state.globalExitHook && entry.sessionId) {
      try {
        state.globalExitHook(sid, entry.workspace);
      } catch {
        // don't let push errors break process cleanup
      }
    }
    const ttl = setTimeout(() => {
      liveEvents.delete(entry.mapKey);
      liveListeners.delete(entry.mapKey);
    }, LIVE_EVENT_TTL_MS);
    ttl.unref();
  };
  child.on("close", onExit);
  child.on("error", onExit);
}

export function onProcessExit(sessionId: string, cb: () => void): () => void {
  if (!processes.has(sessionId)) {
    return () => {};
  }
  let set = exitListeners.get(sessionId);
  if (!set) {
    set = new Set();
    exitListeners.set(sessionId, set);
  }
  const captured = set;
  captured.add(cb);
  return () => { captured.delete(cb); };
}

function moveMapKey<T>(map: Map<string, T>, from: string, to: string, merge: (prev: T | undefined, incoming: T) => T): void {
  const incoming = map.get(from);
  if (!incoming) return;
  map.set(to, merge(map.get(to), incoming));
  map.delete(from);
}

export function promoteToSessionId(requestId: string, sessionId: string): void {
  const entry = processes.get(requestId);
  if (!entry) return;
  entry.sessionId = sessionId;
  if (sessionId !== requestId) {
    processes.set(sessionId, entry);
    processes.delete(requestId);
    entry.mapKey = sessionId;
    moveMapKey(exitListeners, requestId, sessionId, (prev, incoming) => {
      if (!prev) return incoming;
      for (const cb of incoming) prev.add(cb);
      return prev;
    });
    moveMapKey(liveEvents, requestId, sessionId, (prev, incoming) => (prev ? prev.concat(incoming) : incoming));
    moveMapKey(liveListeners, requestId, sessionId, (prev, incoming) => {
      if (!prev) return incoming;
      for (const cb of incoming) prev.add(cb);
      return prev;
    });
  }
}

export function getActiveSessionIds(): string[] {
  const seen = new Set<string>();
  for (const [key, entry] of processes) {
    seen.add(entry.sessionId ?? key);
  }
  return Array.from(seen);
}

export function isActive(sessionId: string): boolean {
  return processes.has(sessionId);
}

export function killProcess(sessionId: string): boolean {
  const entry = processes.get(sessionId);
  if (!entry) return false;
  entry.child.kill("SIGTERM");
  return true;
}

export function killAllProcesses(): void {
  for (const entry of processes.values()) {
    try {
      entry.child.kill("SIGTERM");
    } catch {
      // already dead
    }
  }
}
