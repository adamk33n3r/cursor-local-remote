"use client";

import type { FlowState, HostRow } from "./flow-state";

type StateDumpProps = {
  state: FlowState;
};

export function StateDump({ state }: StateDumpProps) {
  return (
    <pre className="max-h-40 overflow-auto rounded border border-border bg-black/80 p-2 font-mono text-[10px] leading-snug text-success">
      {JSON.stringify(state, null, 2)}
    </pre>
  );
}

type DemoLabProps = {
  hosts: HostRow[];
  onFlipOnline: (id: string) => void;
  onRestore: () => void;
  onOpenHostUrl: (id: string) => void;
};

export function DemoLab({ hosts, onFlipOnline, onRestore, onOpenHostUrl }: DemoLabProps) {
  return (
    <div className="flex flex-wrap gap-2 text-[11px] text-text-muted">
      <span className="self-center">Lab (not product):</span>
      {hosts.map((h) => (
        <button
          key={`flip-${h.id}`}
          type="button"
          className="rounded border border-border px-2 py-1 hover:bg-bg-hover"
          onClick={() => onFlipOnline(h.id)}
        >
          Flip {h.displayName}
        </button>
      ))}
      {hosts.map((h) => (
        <button
          key={`url-${h.id}`}
          type="button"
          className="rounded border border-border px-2 py-1 hover:bg-bg-hover"
          onClick={() => onOpenHostUrl(h.id)}
        >
          Open /h/{h.id}
        </button>
      ))}
      <button type="button" className="rounded border border-border px-2 py-1 hover:bg-bg-hover" onClick={onRestore}>
        Restore Hosts
      </button>
    </div>
  );
}
