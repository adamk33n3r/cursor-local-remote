"use client";

import { useEffect, useState } from "react";
import { startReconnectingWebSocket } from "@/lib/reconnect-live-ws";

type HostRow = { id: string; online: boolean };

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

function asHostRows(value: unknown): HostRow[] | null {
  if (!value || typeof value !== "object" || !("hosts" in value)) return null;
  const hosts = (value as { hosts: unknown }).hosts;
  if (!Array.isArray(hosts)) return null;
  return hosts.filter((row): row is HostRow => {
    if (!row || typeof row !== "object") return false;
    const rec = row as { id?: unknown; online?: unknown };
    return typeof rec.id === "string" && typeof rec.online === "boolean";
  });
}

export function RelayChrome({ hostId }: { hostId: string | null }) {
  const [lost, setLost] = useState(false);

  useEffect(() => {
    const id = hostId || pickedHostId();
    if (!id) return;
    let cancelled = false;

    function apply(rows: HostRow[]): void {
      const row = rows.find((h) => h.id === id);
      if (!row) {
        window.location.replace("/hosts");
        return;
      }
      setLost(!row.online);
    }

    async function loadHttp(): Promise<void> {
      try {
        const res = await fetch("/api/hosts");
        if (!res.ok) return;
        const rows = asHostRows(await res.json());
        if (!cancelled && rows) apply(rows);
      } catch (err) {
        console.error(err);
      }
    }

    const live = startReconnectingWebSocket({
      url: liveUrl,
      onDisconnected() {
        if (!cancelled) setLost(true);
      },
      onMessage(data) {
        try {
          const rows = asHostRows(JSON.parse(data));
          if (rows) apply(rows);
        } catch (err) {
          console.error("Host list live snapshot was not JSON", err);
        }
      },
    });

    void loadHttp();
    return () => {
      cancelled = true;
      live.stop();
    };
  }, [hostId]);

  return (
    <>
      <div
        className="relative z-30 flex shrink-0 items-center justify-between border-b border-border px-3 py-2"
        data-relay-host-id={hostId ?? ""}
      >
        <a href="/hosts" className="rounded px-2 py-1 text-sm text-text-secondary hover:bg-bg-hover">
          Hosts
        </a>
        <form method="post" action="/logout">
          <button type="submit" className="text-sm text-text-muted hover:text-text">
            Logout
          </button>
        </form>
      </div>
      {lost ? (
        <div
          className="fixed inset-x-0 bottom-0 top-11 z-20 flex items-center justify-center bg-bg/70 backdrop-blur-[1px]"
          data-host-lost
        >
          <p className="px-6 text-center text-lg text-text">Connection lost to Host, waiting for reconnect</p>
        </div>
      ) : null}
    </>
  );
}