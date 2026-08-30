"use client";

import { useState } from "react";
import type { HostListFlow } from "./flow-state";
import { HostStandin } from "./host-standin";

type VariantAProps = {
  flow: HostListFlow;
};

export function VariantA({ flow }: VariantAProps) {
  const { state, selectedHost, login, logout, pick, backToList, forget } = flow;
  const [user, setUser] = useState("adam");
  const [pass, setPass] = useState("secret");

  if (state.screen === "login") {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-bg px-6">
        <p className="mb-8 text-[11px] uppercase tracking-[0.25em] text-text-muted">Cursor Remote</p>
        <form
          className="w-full max-w-sm space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            login(user, pass);
          }}
        >
          <input
            className="w-full rounded border border-border bg-bg-surface px-3 py-2 text-text"
            placeholder="Username"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            autoComplete="username"
          />
          <input
            className="w-full rounded border border-border bg-bg-surface px-3 py-2 text-text"
            placeholder="Password"
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            autoComplete="current-password"
          />
          <button type="submit" className="w-full rounded bg-text py-2 text-sm font-medium text-black">
            Login
          </button>
        </form>
        {state.notice ? <p className="mt-4 text-sm text-warning">{state.notice}</p> : null}
      </div>
    );
  }

  if (state.screen === "list") {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-bg">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-text-muted">Host list</p>
            <p className="text-sm text-text-secondary">{state.username}</p>
          </div>
          <button type="button" className="text-sm text-text-muted" onClick={logout}>
            Logout
          </button>
        </header>
        <ul className="flex-1 overflow-auto">
          {state.hosts.length === 0 ? (
            <li className="px-4 py-10 text-center text-sm text-text-muted">No Hosts. Registration is the Host connecting out.</li>
          ) : (
            state.hosts.map((h) => (
              <li key={h.id} className="flex items-center gap-3 border-b border-border-subtle px-4 py-3">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => pick(h.id)}>
                  <p className="truncate text-text">{h.displayName}</p>
                  <p className={`text-xs ${h.online ? "text-success" : "text-text-muted"}`}>
                    {h.online ? "Online" : "Offline"}
                  </p>
                </button>
                <button type="button" className="text-xs text-error" onClick={() => forget(h.id)}>
                  Forget
                </button>
              </li>
            ))
          )}
        </ul>
        {state.notice ? <p className="px-4 py-2 text-sm text-warning">{state.notice}</p> : null}
      </div>
    );
  }

  if (state.screen === "host") {
    if (!selectedHost) return null;
    return (
      <HostStandin host={selectedHost} onBackToList={backToList} onLogout={logout} layout="bar" />
    );
  }

  const _exhaustive: never = state.screen;
  return _exhaustive;
}
