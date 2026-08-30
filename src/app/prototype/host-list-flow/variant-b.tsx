"use client";

import { useState } from "react";
import type { HostListFlow } from "./flow-state";
import { HostStandin } from "./host-standin";

type VariantBProps = {
  flow: HostListFlow;
};

export function VariantB({ flow }: VariantBProps) {
  const { state, selectedHost, login, logout, pick, backToList, forget } = flow;
  const [user, setUser] = useState("adam");
  const [pass, setPass] = useState("secret");
  const [menuFor, setMenuFor] = useState<string | null>(null);

  if (!state.loggedIn) {
    return (
      <div className="flex min-h-0 flex-1">
        <form
          className="flex w-full max-w-md flex-col justify-center gap-3 border-r border-border bg-bg-elevated p-8"
          onSubmit={(e) => {
            e.preventDefault();
            login(user, pass);
          }}
        >
          <p className="text-2xl text-text">Login</p>
          <p className="mb-4 text-sm text-text-muted">One Relay-wide username and password. No signup.</p>
          <input
            className="rounded border border-border bg-bg px-3 py-2 text-text"
            placeholder="Username"
            value={user}
            onChange={(e) => setUser(e.target.value)}
          />
          <input
            className="rounded border border-border bg-bg px-3 py-2 text-text"
            placeholder="Password"
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
          />
          <button type="submit" className="rounded border border-text px-3 py-2 text-sm text-text">
            Continue
          </button>
          {state.notice ? <p className="text-sm text-warning">{state.notice}</p> : null}
        </form>
        <div className="relative hidden flex-1 items-center justify-center bg-bg sm:flex">
          <div className="pointer-events-none w-56 opacity-30 blur-[1px]">
            <p className="mb-3 text-xs uppercase tracking-wide text-text-muted">Hosts (locked)</p>
            {state.hosts.map((h) => (
              <div key={h.id} className="mb-2 rounded border border-border px-3 py-2 text-sm">
                {h.displayName}
              </div>
            ))}
          </div>
          <p className="absolute bottom-6 text-xs text-text-muted">List is behind Login. You do not type a Host address.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-[min(100%,16rem)] shrink-0 flex-col border-r border-border bg-bg-elevated">
        <div className="flex items-center justify-between px-3 py-3">
          <p className="text-xs uppercase tracking-wide text-text-muted">Hosts</p>
          <button type="button" className="text-xs text-text-muted" onClick={logout}>
            Logout
          </button>
        </div>
        <nav className="flex-1 overflow-auto px-2">
          {state.hosts.length === 0 ? (
            <p className="px-2 py-6 text-sm text-text-muted">Empty list. Wait for Registration.</p>
          ) : (
            state.hosts.map((h) => {
              const active = state.selectedHostId === h.id;
              return (
                <div key={h.id} className={`mb-1 rounded ${active ? "bg-bg-active" : ""}`}>
                  <div className="flex items-stretch">
                    <button
                      type="button"
                      className="min-w-0 flex-1 px-3 py-2 text-left"
                      onClick={() => pick(h.id)}
                    >
                      <p className={`truncate text-sm ${h.online ? "text-text" : "text-text-muted"}`}>{h.displayName}</p>
                      <p className="text-[10px] text-text-muted">{h.online ? "Online" : "Offline"}</p>
                    </button>
                    <button
                      type="button"
                      className="px-2 text-text-muted"
                      aria-label={`More for ${h.displayName}`}
                      onClick={() => setMenuFor(menuFor === h.id ? null : h.id)}
                    >
                      ⋯
                    </button>
                  </div>
                  {menuFor === h.id ? (
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-xs text-error"
                      onClick={() => {
                        forget(h.id);
                        setMenuFor(null);
                      }}
                    >
                      Forget
                    </button>
                  ) : null}
                </div>
              );
            })
          )}
        </nav>
        {state.screen === "host" ? (
          <button type="button" className="border-t border-border px-3 py-2 text-left text-xs text-text-secondary" onClick={backToList}>
            Show list only (deselect)
          </button>
        ) : null}
      </aside>
      <main className="min-w-0 flex-1">
        {state.screen === "host" && selectedHost ? (
          <HostStandin host={selectedHost} onBackToList={backToList} onLogout={logout} layout="chrome-less" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-8 text-center">
            <p className="text-sm text-text-muted">Pick an online Host in the rail.</p>
            {state.notice ? <p className="mt-3 text-sm text-warning">{state.notice}</p> : null}
          </div>
        )}
      </main>
    </div>
  );
}
