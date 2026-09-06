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

const REGISTRY_KEY = "__cursorRemoteRelayHosts";
const LISTENERS_KEY = "__cursorRemoteRelayHostListeners";

type RelayGlobals = typeof globalThis & {
  [REGISTRY_KEY]?: Map<string, HostRecord>;
  [LISTENERS_KEY]?: Set<() => void>;
};

function registry(): Map<string, HostRecord> {
  const g = globalThis as RelayGlobals;
  const existing = g[REGISTRY_KEY];
  if (existing) return existing;
  const created = new Map<string, HostRecord>();
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

export function getOnlineHost(id: string): HostRecord | null {
  const row = registry().get(id);
  if (!row?.online || !row.socket) return null;
  return row;
}
