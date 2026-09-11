"use client";

import { useEffect, useState } from "react";
import { startReconnectingWebSocket } from "../../lib/reconnect-live-ws";

type HostRow = { id: string; name: string; online: boolean };

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
    const rec = row as { id?: unknown; name?: unknown; online?: unknown };
    return typeof rec.id === "string" && typeof rec.name === "string" && typeof rec.online === "boolean";
  });
}

export function HostsList({ showLogout }: { showLogout: boolean }) {
  const [hosts, setHosts] = useState<HostRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let sawList = false;

    function apply(rows: HostRow[]): void {
      if (cancelled) return;
      sawList = true;
      setError(null);
      setHosts(rows);
    }

    async function loadHttp(): Promise<void> {
      try {
        const res = await fetch("/api/hosts");
        if (!res.ok) throw new Error(`Host list HTTP ${res.status}`);
        const rows = asHostRows(await res.json());
        if (rows) apply(rows);
      } catch (err: unknown) {
        if (!cancelled && !sawList) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    }

    const live = startReconnectingWebSocket({
      url: liveUrl,
      onMessage(data) {
        try {
          const rows = asHostRows(JSON.parse(data));
          if (rows) apply(rows);
        } catch (err: unknown) {
          console.error(err);
          if (!cancelled) setError(err instanceof Error ? err.message : String(err));
        }
      },
    });

    void loadHttp();
    return () => {
      cancelled = true;
      live.stop();
    };
  }, []);

  async function forget(id: string): Promise<void> {
    const res = await fetch(`/api/hosts/${encodeURIComponent(id)}/forget`, { method: "POST" });
    if (!res.ok && res.status !== 204) {
      setError(await res.text());
    }
  }

  const rows = hosts ?? [];
  const online = rows.filter((h) => h.online);
  const offline = rows.filter((h) => !h.online);

  return (
    <div className="relative flex min-h-dvh flex-col overflow-auto bg-bg px-4 pb-24 pt-6">
      <div className="mb-6 flex items-baseline justify-between">
        <p className="text-3xl font-semibold text-text">Hosts</p>
        {showLogout ? (
          <form method="post" action="/logout">
            <button type="submit" className="text-sm text-text-muted">
              Logout
            </button>
          </form>
        ) : null}
      </div>
      {error && hosts === null ? (
        <p className="text-text-muted">{error}</p>
      ) : hosts === null ? (
        <p className="text-text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-text-muted">Nothing registered yet.</p>
      ) : (
        <ul className="flex flex-col">
          {online.map((host) => (
            <li key={host.id} className="mb-4" data-host-row data-host-id={host.id} data-online="true">
              <a
                href={`/h/${encodeURIComponent(host.id)}/`}
                className="block w-full rounded-3xl bg-bg-surface p-6 text-text"
              >
                <span className="text-xs text-success">Online</span>
                <span className="mt-1 block text-2xl">{host.name}</span>
              </a>
            </li>
          ))}
          {offline.length > 0 ? (
            <li className="mb-2 mt-4 list-none text-xs uppercase tracking-wide text-text-muted">Offline</li>
          ) : null}
          {offline.map((host) => (
            <li
              key={host.id}
              className="mb-2 rounded-2xl border border-border px-4 py-3 text-text-muted"
              data-host-row
              data-host-id={host.id}
              data-online="false"
            >
              <div className="flex items-center justify-between gap-3">
                <span>
                  <span className="text-lg font-medium">{host.name}</span>
                  <span className="mt-1 block text-sm">Offline</span>
                </span>
                <button
                  type="button"
                  className="cursor-pointer text-sm font-medium text-text underline underline-offset-2 hover:text-error"
                  data-forget
                  onClick={() => void forget(host.id)}
                >
                  Forget
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
