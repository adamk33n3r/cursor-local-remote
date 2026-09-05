"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { ChatMessage, ToolCallInfo } from "@/lib/types";
import { apiFetch } from "@/lib/api-fetch";
import { liveWebSocketUrl } from "@/lib/live-ws-url";
import { vlog } from "@/lib/verbose";

export interface SessionWatchState {
  messages: ChatMessage[];
  toolCalls: ToolCallInfo[];
  isWatching: boolean;
  isActive: boolean;
  lastModified: number;
}

interface WatchPayload {
  messages?: ChatMessage[];
  toolCalls?: ToolCallInfo[];
  modifiedAt?: number;
  isActive?: boolean;
}

type WatchServerMessage =
  | { event: "connected"; data: WatchPayload }
  | { event: "update"; data: WatchPayload };

function parseWatchServerMessage(raw: string): WatchServerMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error("[watch] Failed to parse live message");
    vlog("watch-client", "parse error", String(err));
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  if (!("event" in parsed) || !("data" in parsed)) return null;
  const rec = parsed as { event: unknown; data: unknown };
  if (rec.event !== "connected" && rec.event !== "update") return null;
  if (!rec.data || typeof rec.data !== "object") return null;
  return { event: rec.event, data: rec.data as WatchPayload };
}

interface UseSessionWatchOptions {
  onStreamEnd?: () => void;
  onStreamStart?: () => void;
}

export function useSessionWatch(options: UseSessionWatchOptions = {}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCallInfo[]>([]);
  const [isWatching, setIsWatching] = useState(false);
  const [isActive, setIsActive] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const lastModifiedRef = useRef<number>(0);
  const onStreamEndRef = useRef(options.onStreamEnd);
  const onStreamStartRef = useRef(options.onStreamStart);

  useEffect(() => { onStreamEndRef.current = options.onStreamEnd; }, [options.onStreamEnd]);
  useEffect(() => { onStreamStartRef.current = options.onStreamStart; }, [options.onStreamStart]);

  const stopWatching = useCallback(() => {
    if (socketRef.current) {
      vlog("watch-client", "stopWatching: closing WebSocket");
      socketRef.current.close();
      socketRef.current = null;
    }
    setIsWatching(false);
  }, []);

  const mergeMessages = useCallback((incoming: ChatMessage[]) => {
    setMessages((prev) => {
      const incomingIds = new Set(incoming.map((m) => m.id));
      const incomingUserTexts = new Set(
        incoming.filter((m) => m.role === "user").map((m) => m.content.trim()),
      );
      const optimistic = prev.filter(
        (m) =>
          m.role === "user" &&
          !incomingIds.has(m.id) &&
          !incomingUserTexts.has(m.content.trim()),
      );
      vlog("watch-client", "mergeMessages", { incoming: incoming.length, prev: prev.length, optimistic: optimistic.length });
      if (optimistic.length === 0) return incoming;
      return [...incoming, ...optimistic];
    });
  }, []);

  const applyUpdate = useCallback((data: WatchPayload) => {
    if (data.messages && data.messages.length > 0) mergeMessages(data.messages);
    if (data.toolCalls && data.toolCalls.length > 0) setToolCalls(data.toolCalls);
    if (data.modifiedAt && data.modifiedAt > lastModifiedRef.current) {
      lastModifiedRef.current = data.modifiedAt;
    }
  }, [mergeMessages]);

  const startWatching = useCallback(
    (id: string, workspace?: string) => {
      stopWatching();

      let path = `/api/sessions/watch?id=${encodeURIComponent(id)}`;
      if (workspace) path += `&workspace=${encodeURIComponent(workspace)}`;
      const url = liveWebSocketUrl(path);
      vlog("watch-client", "startWatching: opening WebSocket", { id, url });
      const ws = new WebSocket(url);
      socketRef.current = ws;

      ws.addEventListener("message", (e) => {
        const msg = parseWatchServerMessage(String(e.data));
        if (!msg) return;

        switch (msg.event) {
          case "connected": {
            setIsWatching(true);
            const data = msg.data;
            vlog("watch-client", "connected event", {
              id, isActive: data.isActive,
              messages: data.messages?.length ?? 0,
              toolCalls: data.toolCalls?.length ?? 0,
              modifiedAt: data.modifiedAt,
            });
            if (data.isActive === true) {
              setIsActive(true);
              onStreamStartRef.current?.();
            } else {
              setIsActive(false);
              onStreamEndRef.current?.();
            }
            if (data.modifiedAt) lastModifiedRef.current = data.modifiedAt;
            if (data.messages && data.messages.length > 0) mergeMessages(data.messages);
            if (data.toolCalls && data.toolCalls.length > 0) setToolCalls(data.toolCalls);
            return;
          }
          case "update": {
            const data = msg.data;
            vlog("watch-client", "update event", {
              id, isActive: data.isActive,
              messages: data.messages?.length ?? 0,
              toolCalls: data.toolCalls?.length ?? 0,
              modifiedAt: data.modifiedAt,
            });
            applyUpdate(data);

            if (data.isActive === false) {
              setIsActive(false);
              onStreamEndRef.current?.();
            } else if (data.isActive === true) {
              setIsActive(true);
            }
            return;
          }
          default: {
            const _never: never = msg;
            return _never;
          }
        }
      });

      ws.addEventListener("error", () => {
        vlog("watch-client", "WebSocket error", { id, readyState: ws.readyState });
      });

      ws.addEventListener("close", () => {
        vlog("watch-client", "WebSocket closed", { id, readyState: ws.readyState });
        if (socketRef.current !== ws) return;
        socketRef.current = null;
        setIsActive(false);
        onStreamEndRef.current?.();
      });
    },
    [stopWatching, applyUpdate, mergeMessages],
  );

  const refreshFromHistory = useCallback(async (sessionId: string, workspace?: string) => {
    const t0 = Date.now();
    try {
      let url = `/api/sessions/history?id=${encodeURIComponent(sessionId)}`;
      if (workspace) url += `&workspace=${encodeURIComponent(workspace)}`;
      vlog("watch-client", "refreshFromHistory: fetch", { sessionId, url });
      const res = await apiFetch(url);
      vlog("watch-client", "refreshFromHistory: response", { sessionId, status: res.status, ok: res.ok });
      if (!res.ok) return;
      const data = await res.json();
      vlog("watch-client", "refreshFromHistory: data", {
        sessionId,
        messages: data.messages?.length ?? 0,
        toolCalls: data.toolCalls?.length ?? 0,
        modifiedAt: data.modifiedAt,
        ms: Date.now() - t0,
      });
      if (data.messages?.length > 0) mergeMessages(data.messages);
      if (data.toolCalls?.length > 0) setToolCalls(data.toolCalls);
      if (data.modifiedAt) lastModifiedRef.current = data.modifiedAt;
    } catch (err) {
      console.error("[watch] Failed to refresh from history");
      vlog("watch-client", "refreshFromHistory: error", { sessionId, error: String(err), ms: Date.now() - t0 });
    }
  }, [mergeMessages]);

  const resetState = useCallback(() => {
    vlog("watch-client", "resetState");
    setMessages([]);
    setToolCalls([]);
    setIsActive(false);
    lastModifiedRef.current = 0;
  }, []);

  useEffect(() => {
    return () => { stopWatching(); };
  }, [stopWatching]);

  return {
    messages,
    setMessages,
    toolCalls,
    setToolCalls,
    isWatching,
    isActive,
    setIsActive,
    startWatching,
    stopWatching,
    refreshFromHistory,
    resetState,
    lastModifiedRef,
  };
}
