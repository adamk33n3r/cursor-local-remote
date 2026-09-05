"use client";

import { useEffect, useState } from "react";
import { liveWebSocketUrl } from "@/lib/live-ws-url";
import type { TerminalInfo } from "@/lib/types";

const RECONNECT_MS = 1_000;

type ListServerMessage =
  | { event: "connected"; data: { terminals: TerminalInfo[] } }
  | { event: "update"; data: { terminals: TerminalInfo[] } };

function isTerminalInfo(value: unknown): value is TerminalInfo {
  if (!value || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  return typeof rec.id === "string"
    && typeof rec.cwd === "string"
    && typeof rec.running === "boolean"
    && (rec.exitCode === null || typeof rec.exitCode === "number")
    && typeof rec.startedAt === "number";
}

function parseListServerMessage(raw: string): ListServerMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  if (!("event" in parsed) || !("data" in parsed)) return null;
  const rec = parsed as { event: unknown; data: unknown };
  if (rec.event !== "connected" && rec.event !== "update") return null;
  if (!rec.data || typeof rec.data !== "object") return null;
  if (!("terminals" in rec.data) || !Array.isArray((rec.data as { terminals: unknown }).terminals)) return null;
  const terminals = (rec.data as { terminals: unknown[] }).terminals.filter(isTerminalInfo);
  return { event: rec.event, data: { terminals } };
}

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let snapshot: TerminalInfo[] = [];
const listeners = new Set<(terminals: TerminalInfo[]) => void>();

function emit(next: TerminalInfo[]): void {
  snapshot = next;
  for (const cb of listeners) cb(snapshot);
}

function clearReconnect(): void {
  if (!reconnectTimer) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function teardownSocket(): void {
  clearReconnect();
  if (!socket) return;
  const current = socket;
  socket = null;
  current.close();
}

function ensureSocket(): void {
  if (typeof WebSocket === "undefined") return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

  const ws = new WebSocket(liveWebSocketUrl("/api/terminal/list"));
  socket = ws;

  ws.addEventListener("message", (e) => {
    if (socket !== ws) return;
    const msg = parseListServerMessage(String(e.data));
    if (!msg) return;
    switch (msg.event) {
      case "connected":
      case "update":
        emit(msg.data.terminals);
        return;
      default: {
        const _never: never = msg;
        return _never;
      }
    }
  });

  ws.addEventListener("close", () => {
    if (socket !== ws) return;
    socket = null;
    if (listeners.size === 0) return;
    clearReconnect();
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      ensureSocket();
    }, RECONNECT_MS);
  });
}

function subscribeTerminalList(cb: (terminals: TerminalInfo[]) => void): () => void {
  listeners.add(cb);
  cb(snapshot);
  ensureSocket();
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) teardownSocket();
  };
}

export function useTerminalList(): TerminalInfo[] {
  const [terminals, setTerminals] = useState<TerminalInfo[]>(snapshot);
  useEffect(() => subscribeTerminalList(setTerminals), []);
  return terminals;
}
