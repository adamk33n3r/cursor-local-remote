"use client";

import { useEffect, useState } from "react";

type HostRow = { id: string; name: string; online: boolean };

export default function HostsPage() {
  const [hosts, setHosts] = useState<HostRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/hosts")
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Host list failed (${res.status})`);
        }
        return (await res.json()) as { hosts: HostRow[] };
      })
      .then((body) => setHosts(body.hosts))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  const rows = hosts ?? [];

  return (
    <div className="relative flex min-h-dvh flex-col overflow-auto bg-bg px-4 pb-24 pt-6">
      <div className="mb-6 flex items-baseline justify-between">
        <p className="text-3xl font-semibold text-text">Hosts</p>
        <form method="post" action="/logout">
          <button type="submit" className="text-sm text-text-muted">
            Logout
          </button>
        </form>
      </div>
      {error ? (
        <p className="text-text-muted">{error}</p>
      ) : hosts === null ? (
        <p className="text-text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-text-muted">Nothing registered yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((host) => (
            <li key={host.id} data-host-row data-host-id={host.id}>
              {host.online ? (
                <a
                  href={`/h/${encodeURIComponent(host.id)}/`}
                  className="block rounded-xl bg-bg-surface px-4 py-4 text-text"
                >
                  <span className="text-lg font-medium">{host.name}</span>
                  <span className="mt-1 block text-sm text-success">Online</span>
                </a>
              ) : (
                <div className="rounded-xl px-4 py-4 text-text-muted">
                  <span className="text-lg font-medium">{host.name}</span>
                  <span className="mt-1 block text-sm">Offline</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
