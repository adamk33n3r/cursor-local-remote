"use client";

import { useMemo, useState } from "react";
import type { HostRow } from "./flow-state";

type HostStandinProps = {
  host: HostRow;
  onBackToList: () => void;
  onLogout: () => void;
  layout: "bar" | "chrome-less" | "chip";
};

type KnownWorkspace = {
  path: string;
  name: string;
};

type FakeSession = {
  id: string;
  label: string;
  workspace: string;
};

const START_DIRECTORY = "D:\\dev";

const SEED_WORKSPACES: KnownWorkspace[] = [
  { path: "D:\\dev\\cursor-local-remote", name: "cursor-local-remote" },
  { path: "D:\\dev\\notes", name: "notes" },
];

const SEED_SESSIONS: FakeSession[] = [
  { id: "s1", label: "Fix login cookie on Relay path", workspace: "D:\\dev\\cursor-local-remote" },
  { id: "s2", label: "Host list Login cookie", workspace: "D:\\dev\\cursor-local-remote" },
  { id: "s3", label: "Weekly notes", workspace: "D:\\dev\\notes" },
];

const BROWSE_FOLDERS: KnownWorkspace[] = [
  { path: "D:\\dev", name: "dev" },
  { path: "D:\\dev\\cursor-local-remote", name: "cursor-local-remote" },
  { path: "D:\\dev\\notes", name: "notes" },
  { path: "D:\\dev\\scratch", name: "scratch" },
];

export function HostStandin({ host, onBackToList, onLogout, layout }: HostStandinProps) {
  const [workspaces, setWorkspaces] = useState<KnownWorkspace[]>(SEED_WORKSPACES);
  const [currentPath, setCurrentPath] = useState(SEED_WORKSPACES[0].path);
  const [sessions, setSessions] = useState<FakeSession[]>(SEED_SESSIONS);
  const [activeId, setActiveId] = useState<string>(SEED_SESSIONS[0].id);
  const [listOpen, setListOpen] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [browsePath, setBrowsePath] = useState(START_DIRECTORY);

  const current = workspaces.find((w) => w.path === currentPath) ?? workspaces[0];
  const inWorkspace = sessions.filter((s) => s.workspace === currentPath);
  const active = sessions.find((s) => s.id === activeId);

  const browseHere = useMemo(
    () => BROWSE_FOLDERS.filter((f) => f.path.startsWith(browsePath) && f.path !== browsePath),
    [browsePath],
  );

  const newSession = () => {
    const id = `s${sessions.length + 1}`;
    const row = { id, label: "New session", workspace: currentPath };
    setSessions((prev) => [row, ...prev]);
    setActiveId(id);
    setListOpen(true);
  };

  const openWorkspace = (path: string, name: string) => {
    setWorkspaces((prev) => (prev.some((w) => w.path === path) ? prev : [...prev, { path, name }]));
    setCurrentPath(path);
    const id = `s${Date.now()}`;
    const row = { id, label: "New session", workspace: path };
    setSessions((prev) => [row, ...prev]);
    setActiveId(id);
    setBrowserOpen(false);
    setPickerOpen(false);
    setListOpen(true);
  };

  const sessionList = (
    <div className="flex min-h-0 flex-col p-2">
      <button
        type="button"
        className="mb-2 w-full truncate rounded border border-border px-2 py-2 text-left text-sm text-text"
        onClick={() => setPickerOpen((v) => !v)}
      >
        <p className="text-[10px] uppercase tracking-wide text-text-muted">Workspace</p>
        <p className="truncate">{current?.name ?? "Workspace"}</p>
      </button>
      {pickerOpen ? (
        <div className="mb-2 rounded border border-border bg-bg p-1">
          {workspaces.map((w) => (
            <button
              key={w.path}
              type="button"
              className={`mb-1 w-full truncate rounded px-2 py-1.5 text-left text-sm ${
                w.path === currentPath ? "bg-bg-active text-text" : "text-text-secondary"
              }`}
              onClick={() => {
                setCurrentPath(w.path);
                const first = sessions.find((s) => s.workspace === w.path);
                if (first) setActiveId(first.id);
                setPickerOpen(false);
              }}
            >
              {w.name}
            </button>
          ))}
          <button
            type="button"
            className="w-full rounded px-2 py-1.5 text-left text-sm text-text"
            onClick={() => {
              setBrowsePath(START_DIRECTORY);
              setBrowserOpen(true);
              setPickerOpen(false);
            }}
          >
            Open Workspace…
          </button>
        </div>
      ) : null}
      <button
        type="button"
        className="mb-2 rounded bg-text px-2 py-2 text-sm font-medium text-black"
        onClick={newSession}
      >
        New session
      </button>
      <p className="mb-1 px-1 text-[10px] uppercase tracking-wide text-text-muted">Sessions</p>
      <ul className="min-h-0 flex-1 overflow-auto">
        {inWorkspace.length === 0 ? (
          <li className="px-1 text-xs text-text-muted">No Sessions in this Workspace</li>
        ) : (
          inWorkspace.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className={`mb-1 w-full truncate rounded px-2 py-2 text-left text-sm ${
                  s.id === activeId ? "bg-bg-active text-text" : "text-text-secondary"
                }`}
                onClick={() => setActiveId(s.id)}
              >
                {s.label}
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );

  const browser = browserOpen ? (
    <div className="absolute inset-0 z-20 flex flex-col bg-bg">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <button type="button" className="text-sm text-text-secondary" onClick={() => setBrowserOpen(false)}>
          Cancel
        </button>
        <span className="min-w-0 flex-1 truncate text-sm text-text-muted">{browsePath}</span>
        <button
          type="button"
          className="text-sm text-text"
          onClick={() => openWorkspace(browsePath, browsePath.split("\\").pop() ?? browsePath)}
        >
          Open Workspace
        </button>
      </div>
      <p className="px-3 py-2 text-xs text-text-muted">Disk browser stand-in. Enter a folder; Open starts a Session here.</p>
      <ul className="flex-1 overflow-auto px-2">
        {browseHere.map((f) => (
          <li key={f.path}>
            <button
              type="button"
              className="w-full rounded px-3 py-3 text-left text-text"
              onClick={() => setBrowsePath(f.path)}
            >
              {f.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  ) : null;

  switch (layout) {
    case "chrome-less":
      return (
        <div className="flex h-full min-h-0 flex-col bg-bg">
          <div className="border-b border-border px-4 py-3">
            <p className="text-[10px] uppercase tracking-widest text-text-muted">Host stand-in · not the real Host</p>
            <p className="text-lg text-text">{host.displayName}</p>
            <p className="text-sm text-text-secondary">{current?.path}</p>
          </div>
          <div className="flex-1 p-4 text-sm text-text-secondary">{active?.label}</div>
        </div>
      );
    case "chip":
      return (
        <div className="relative flex h-full min-h-0 flex-col bg-bg">
          <header className="flex items-center gap-2 border-b border-border px-3 py-2">
            <button type="button" className="rounded px-2 py-1 text-sm text-text-secondary hover:bg-bg-hover" onClick={onBackToList}>
              Hosts
            </button>
            <button
              type="button"
              className="rounded px-2 py-1 text-sm text-text-secondary hover:bg-bg-hover"
              onClick={() => setListOpen((v) => !v)}
            >
              Workspaces
            </button>
            <span className="min-w-0 flex-1 truncate text-sm text-text">{host.displayName}</span>
            <button type="button" className="text-sm text-text-muted hover:text-text" onClick={onLogout}>
              Logout
            </button>
          </header>
          <div className="flex min-h-0 flex-1">
            {listOpen ? (
              <aside className="w-[min(100%,16rem)] shrink-0 border-r border-border bg-bg-elevated">{sessionList}</aside>
            ) : null}
            <div className="min-w-0 flex-1 p-4">
              <p className="mb-2 text-[10px] uppercase tracking-wide text-text-muted">{current?.name}</p>
              <p className="text-sm text-text">{active?.label ?? "No session"}</p>
              <p className="mt-2 text-sm text-text-secondary">
                Sessions belong to a Workspace. New session stays here. Open Workspace is the disk browser.
              </p>
            </div>
          </div>
          {browser}
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
            <aside className="w-52 shrink-0 border-r border-border">{sessionList}</aside>
            <div className="flex-1 p-4 text-sm text-text-secondary">{active?.label}</div>
          </div>
        </div>
      );
    default: {
      const _exhaustive: never = layout;
      return _exhaustive;
    }
  }
}
