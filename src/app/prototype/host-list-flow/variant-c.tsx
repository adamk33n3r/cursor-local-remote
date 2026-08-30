"use client";

import { useState } from "react";
import type { HostListFlow } from "./flow-state";
import { HostStandin } from "./host-standin";

type VariantCProps = {
  flow: HostListFlow;
};

export function VariantC({ flow }: VariantCProps) {
  const { state, selectedHost, login, logout, pick, backToList, forget } = flow;
  const [user, setUser] = useState("adam");
  const [pass, setPass] = useState("secret");

  if (state.screen === "login") {
    return (
      <div className="relative flex min-h-0 flex-1 flex-col justify-end bg-[#101014] px-5 pb-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_#2a2a33,_transparent_55%)]" />
        <div className="relative">
          <p className="text-4xl font-semibold tracking-tight text-text">Cursor Remote</p>
          <p className="mt-2 mb-8 text-text-secondary">Login on the Host list. Then pick a Host.</p>
          <form
            className="space-y-3 rounded-t-3xl bg-bg p-5"
            onSubmit={(e) => {
              e.preventDefault();
              login(user, pass);
            }}
          >
            <input
              className="w-full rounded-2xl bg-bg-surface px-4 py-3 text-text"
              placeholder="Username"
              value={user}
              onChange={(e) => setUser(e.target.value)}
            />
            <input
              className="w-full rounded-2xl bg-bg-surface px-4 py-3 text-text"
              placeholder="Password"
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
            />
            <button type="submit" className="w-full rounded-2xl bg-success py-3 font-medium text-black">
              Login
            </button>
            {state.notice ? <p className="text-sm text-warning">{state.notice}</p> : null}
          </form>
        </div>
      </div>
    );
  }

  if (state.screen === "list") {
    const online = state.hosts.filter((h) => h.online);
    const offline = state.hosts.filter((h) => !h.online);

    return (
      <div className="relative flex min-h-0 flex-1 flex-col overflow-auto bg-bg px-4 pb-24 pt-6">
        <div className="mb-6 flex items-baseline justify-between">
          <p className="text-3xl font-semibold text-text">Hosts</p>
          <button type="button" className="text-sm text-text-muted" onClick={logout}>
            Logout
          </button>
        </div>
        {state.hosts.length === 0 ? (
          <p className="text-text-muted">Nothing registered yet.</p>
        ) : (
          <>
            {online.map((h) => (
              <button
                key={h.id}
                type="button"
                className="mb-4 w-full rounded-3xl bg-bg-surface p-6 text-left"
                onClick={() => pick(h.id)}
              >
                <p className="text-xs text-success">Online</p>
                <p className="mt-1 text-2xl text-text">{h.displayName}</p>
                <p className="mt-3 text-sm text-text-secondary">Tap to open this Host</p>
              </button>
            ))}
            {offline.length > 0 ? (
              <p className="mb-2 mt-4 text-xs uppercase tracking-wide text-text-muted">Offline</p>
            ) : null}
            {offline.map((h) => (
              <div key={h.id} className="mb-2 flex items-center gap-2 rounded-2xl border border-border px-4 py-3">
                <button type="button" className="flex-1 text-left text-text-muted" onClick={() => pick(h.id)}>
                  {h.displayName}
                </button>
                <button type="button" className="text-xs text-error" onClick={() => forget(h.id)}>
                  Forget
                </button>
              </div>
            ))}
          </>
        )}
        {state.notice ? <p className="mt-4 text-sm text-warning">{state.notice}</p> : null}
      </div>
    );
  }

  if (state.screen === "host") {
    if (!selectedHost) return null;
    return (
      <HostStandin host={selectedHost} onBackToList={backToList} onLogout={logout} layout="chip" />
    );
  }

  const _exhaustive: never = state.screen;
  return _exhaustive;
}
