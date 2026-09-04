import type { ChildProcess } from "child_process";
import { LIVE_EVENT_TTL_MS } from "@/lib/constants";

type ProcessExitHook = (sessionId: string, workspace: string) => void;

interface RunningProcess {
  child: ChildProcess;
  sessionId: string | null;
  mapKey: string;
  workspace: string;
  startedAt: number;
}

let globalExitHook: ProcessExitHook | null = null;

export function setProcessExitHook(hook: ProcessExitHook): void {
  globalExitHook = hook;
}

const processes = new Map<string, RunningProcess>();
const exitListeners = new Map<string, Set<() => void>>();
const liveEvents = new Map<string, Record<string, unknown>[]>();
const liveListeners = new Map<string, Set<() => void>>();

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

  const onExit = () => {
    const sid = entry.sessionId ?? entry.mapKey;
    processes.delete(entry.mapKey);
    const listeners = exitListeners.get(entry.mapKey);
    if (listeners) {
      exitListeners.delete(entry.mapKey);
      for (const cb of listeners) cb();
    }
    if (globalExitHook && entry.sessionId) {
      try {
        globalExitHook(sid, entry.workspace);
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
    cb();
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

export function promoteToSessionId(requestId: string, sessionId: string): void {
  const entry = processes.get(requestId);
  if (!entry) return;
  entry.sessionId = sessionId;
  if (sessionId !== requestId) {
    processes.set(sessionId, entry);
    processes.delete(requestId);
    entry.mapKey = sessionId;
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
