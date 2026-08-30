"use client";

import type { HostRow } from "./flow-state";

type HostStandinProps = {
  host: HostRow;
  onBackToList: () => void;
  onLogout: () => void;
  layout: "bar" | "chrome-less" | "chip";
};

export function HostStandin({ host, onBackToList, onLogout, layout }: HostStandinProps) {
  const fakeSession = "Fix login cookie on Relay path";

  switch (layout) {
    case "chrome-less":
      return (
        <div className="flex h-full min-h-0 flex-col bg-bg">
          <div className="border-b border-border px-4 py-3">
            <p className="text-[10px] uppercase tracking-widest text-text-muted">Host stand-in · not the real Host</p>
            <p className="text-lg text-text">{host.displayName}</p>
            <p className="text-sm text-text-secondary">Workspace D:\dev\cursor-local-remote</p>
          </div>
          <div className="flex-1 space-y-3 overflow-auto p-4">
            <div className="rounded-lg bg-bg-surface p-3 text-sm text-text-secondary">
              User: continue the Session at the desk after this Client start.
            </div>
            <div className="rounded-lg bg-bg-elevated p-3 text-sm text-text">
              Agent: stand-in only. No tunnel, no Agent process.
            </div>
          </div>
          <div className="border-t border-border p-3 text-sm text-text-muted">{fakeSession}</div>
        </div>
      );
    case "chip":
      return (
        <div className="relative flex h-full min-h-0 flex-col bg-[#07070a]">
          <div className="absolute left-3 top-3 z-10 flex gap-2">
            <button
              type="button"
              className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-black shadow"
              onClick={onBackToList}
            >
              Hosts
            </button>
          </div>
          <button
            type="button"
            className="absolute right-3 top-3 z-10 text-xs text-text-muted underline"
            onClick={onLogout}
          >
            Logout
          </button>
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
            <p className="text-[10px] uppercase tracking-[0.3em] text-text-muted">Inside {host.displayName}</p>
            <p className="text-3xl font-medium text-text">Host stand-in</p>
            <p className="max-w-sm text-sm text-text-secondary">
              Sticky path would keep refresh here. Back to list does not log you out.
            </p>
          </div>
        </div>
      );
    case "bar":
      return (
        <div className="flex h-full min-h-0 flex-col bg-bg">
          <header className="flex items-center gap-2 border-b border-border px-3 py-2">
            <button type="button" className="rounded px-2 py-1 text-sm text-text-secondary hover:bg-bg-hover" onClick={onBackToList}>
              Hosts
            </button>
            <span className="flex-1 truncate text-sm text-text">{host.displayName}</span>
            <button type="button" className="text-sm text-text-muted hover:text-text" onClick={onLogout}>
              Logout
            </button>
          </header>
          <div className="flex min-h-0 flex-1">
            <aside className="hidden w-44 shrink-0 border-r border-border p-2 text-xs text-text-muted sm:block">
              <p className="mb-2 text-[10px] uppercase tracking-wide">Sessions</p>
              <p className="rounded bg-bg-surface px-2 py-1 text-text">{fakeSession}</p>
              <p className="mt-1 px-2 py-1">New session</p>
            </aside>
            <div className="flex-1 p-4 text-sm text-text-secondary">
              <p className="mb-2 text-[10px] uppercase tracking-wide text-text-muted">Stand-in Host UI</p>
              <p>This is the stock Host: workspaces, sessions, model/mode — not implemented here.</p>
              <p className="mt-2 text-text-muted">Relay-path chrome: Hosts (back to list) and Logout live in the same control area.</p>
            </div>
          </div>
        </div>
      );
    default: {
      const _exhaustive: never = layout;
      return _exhaustive;
    }
  }
}
