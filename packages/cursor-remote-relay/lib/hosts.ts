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

type RelayGlobals = typeof globalThis & {
  [REGISTRY_KEY]?: Map<string, HostRecord>;
};

function registry(): Map<string, HostRecord> {
  const g = globalThis as RelayGlobals;
  const existing = g[REGISTRY_KEY];
  if (existing) return existing;
  const created = new Map<string, HostRecord>();
  g[REGISTRY_KEY] = created;
  return created;
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
  return row;
}

export function markHostOffline(id: string): void {
  const row = registry().get(id);
  if (!row) return;
  row.online = false;
  row.socket = undefined;
}

export function getOnlineHost(id: string): HostRecord | null {
  const row = registry().get(id);
  if (!row?.online || !row.socket) return null;
  return row;
}
