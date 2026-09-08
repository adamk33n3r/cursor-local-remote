import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { WebSocket } from "ws";

export type HostRecord = {
  id: string;
  name: string;
  online: boolean;
  socket?: WebSocket;
};

export type HostListItem = {
  id: string;
  name: string;
  online: boolean;
};

export type ForgetResult = "forgotten" | "online" | "missing";

const REGISTRY_KEY = "__cursorRemoteRelayHosts";
const LISTENERS_KEY = "__cursorRemoteRelayHostListeners";

type RelayGlobals = typeof globalThis & {
  [REGISTRY_KEY]?: Map<string, HostRecord>;
  [LISTENERS_KEY]?: Set<() => void>;
};

export function relayStateDir(): string {
  return process.env.CURSOR_REMOTE_RELAY_STATE_DIR || join(homedir(), ".cursor-remote-relay");
}

function persistPath(): string {
  return join(relayStateDir(), "hosts.json");
}

function persistHosts(rows: HostListItem[]): void {
  mkdirSync(relayStateDir(), { recursive: true });
  const body = {
    hosts: rows.map((h) => ({ id: h.id, name: h.name })),
  };
  writeFileSync(persistPath(), `${JSON.stringify(body, null, 2)}\n`, "utf8");
}

function loadPersistedHosts(): HostRecord[] {
  const file = persistPath();
  if (!existsSync(file)) return [];
  const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!raw || typeof raw !== "object" || !("hosts" in raw) || !Array.isArray((raw as { hosts: unknown }).hosts)) {
    throw new Error(`invalid Host list persist file: ${file}`);
  }
  const hosts: HostRecord[] = [];
  for (const item of (raw as { hosts: unknown[] }).hosts) {
    if (!item || typeof item !== "object") {
      throw new Error(`invalid Host list persist file: ${file}`);
    }
    const rec = item as { id?: unknown; name?: unknown };
    if (typeof rec.id !== "string" || !rec.id || typeof rec.name !== "string" || !rec.name) {
      throw new Error(`invalid Host list persist file: ${file}`);
    }
    hosts.push({ id: rec.id, name: rec.name, online: false });
  }
  return hosts;
}

function registry(): Map<string, HostRecord> {
  const g = globalThis as RelayGlobals;
  const existing = g[REGISTRY_KEY];
  if (existing) return existing;
  const created = new Map<string, HostRecord>();
  for (const row of loadPersistedHosts()) created.set(row.id, row);
  g[REGISTRY_KEY] = created;
  return created;
}

function listeners(): Set<() => void> {
  const g = globalThis as RelayGlobals;
  const existing = g[LISTENERS_KEY];
  if (existing) return existing;
  const created = new Set<() => void>();
  g[LISTENERS_KEY] = created;
  return created;
}

function emitHostsChange(): void {
  for (const fn of listeners()) fn();
}

export function onHostsChange(fn: () => void): () => void {
  listeners().add(fn);
  return () => {
    listeners().delete(fn);
  };
}

export function listHosts(): HostListItem[] {
  return [...registry().values()].map((h) => ({
    id: h.id,
    name: h.name,
    online: h.online,
  }));
}

export function getHost(id: string): HostRecord | null {
  return registry().get(id) ?? null;
}

export function putHost(id: string, name: string, socket: WebSocket): HostRecord {
  const row: HostRecord = { id, name, online: true, socket };
  registry().set(id, row);
  persistHosts(listHosts());
  emitHostsChange();
  return row;
}

export function markHostOffline(id: string): void {
  const row = registry().get(id);
  if (!row) return;
  row.online = false;
  row.socket = undefined;
  emitHostsChange();
}

export function forgetHost(id: string): ForgetResult {
  const row = registry().get(id);
  if (!row) return "missing";
  if (row.online) return "online";
  registry().delete(id);
  persistHosts(listHosts());
  emitHostsChange();
  return "forgotten";
}

export function forgetHttp(
  result: ForgetResult,
): { status: 204 } | { status: 409; body: string } | { status: 404; body: string } {
  switch (result) {
    case "forgotten":
      return { status: 204 };
    case "online":
      return { status: 409, body: "Forget is only for offline Hosts.\n" };
    case "missing":
      return { status: 404, body: "Host is not on the Host list.\n" };
    default: {
      const _exhaustive: never = result;
      return _exhaustive;
    }
  }
}

export function getOnlineHost(id: string): HostRecord | null {
  const row = registry().get(id);
  if (!row?.online || !row.socket) return null;
  return row;
}
