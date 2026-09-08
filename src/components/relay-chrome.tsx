"use client";

import { useEffect } from "react";

function pickedHostId(): string | null {
  const match = /^\/h\/([^/]+)/.exec(window.location.pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch (err) {
    console.error("Host pick path is not a valid Host id", err);
    return null;
  }
}

function liveUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/hosts/live`;
}

export function RelayChrome() {
  useEffect(() => {
    const hostId = pickedHostId();
    if (!hostId) return;
    const ws = new WebSocket(liveUrl());
    ws.onmessage = (event) => {
      try {
        const body = JSON.parse(String(event.data)) as { hosts?: Array<{ id: string }> };
        if (!Array.isArray(body.hosts)) return;
        if (!body.hosts.some((row) => row.id === hostId)) {
          window.location.replace("/hosts");
        }
      } catch (err) {
        console.error("Host list live snapshot was not JSON", err);
      }
    };
    return () => {
      ws.close();
    };
  }, []);

  return (
    <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
      <a href="/hosts" className="rounded px-2 py-1 text-sm text-text-secondary hover:bg-bg-hover">
        Hosts
      </a>
      <form method="post" action="/logout">
        <button type="submit" className="text-sm text-text-muted hover:text-text">
          Logout
        </button>
      </form>
    </div>
  );
}
