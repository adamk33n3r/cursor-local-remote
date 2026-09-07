"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { useHaptics } from "@/hooks/use-haptics";
import { isWindowsDrivesListing, type FsListing } from "@/lib/types";
import { ArrowUp, CloseIcon, PlusIcon, Spinner } from "./icons";

interface OpenWorkspaceBrowserProps {
  open: boolean;
  onClose: () => void;
  onOpen: (workspace: string) => void;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export function OpenWorkspaceBrowser({ open, onClose, onOpen }: OpenWorkspaceBrowserProps) {
  const haptics = useHaptics();
  const [listing, setListing] = useState<FsListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [opening, setOpening] = useState(false);

  const load = useCallback(async (path?: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = path === undefined ? "/api/fs" : `/api/fs?path=${encodeURIComponent(path)}`;
      const res = await apiFetch(url);
      const data = (await res.json()) as FsListing;
      setListing(data);
      setCreating(false);
      setNewName("");
    } catch (err) {
      setError(errorMessage(err, "Failed to list directory"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  if (!open) return null;

  const atDrives = isWindowsDrivesListing(listing?.path);
  const canOpen = Boolean(listing?.path) && !atDrives;
  const canCreate = Boolean(listing?.path) && !atDrives && !creating;

  const handleOpen = async () => {
    if (!listing?.path || isWindowsDrivesListing(listing.path)) return;
    haptics.tap();
    setOpening(true);
    setError(null);
    try {
      const res = await apiFetch("/api/fs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "open", path: listing.path }),
      });
      const data = (await res.json()) as { workspace: string };
      onOpen(data.workspace);
    } catch (err) {
      setError(errorMessage(err, "Failed to open Workspace"));
    } finally {
      setOpening(false);
    }
  };

  const handleMkdir = async () => {
    if (!listing?.path || isWindowsDrivesListing(listing.path) || !newName.trim()) return;
    haptics.tap();
    setError(null);
    try {
      const res = await apiFetch("/api/fs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mkdir", path: listing.path, name: newName }),
      });
      const data = (await res.json()) as { listing: FsListing };
      setListing(data.listing);
      setCreating(false);
      setNewName("");
    } catch (err) {
      setError(errorMessage(err, "Failed to create folder"));
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Open Workspace"
        className="bg-bg-elevated border border-border rounded-xl w-full max-w-md max-h-[80dvh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-border shrink-0">
          <p className="text-[13px] font-medium text-text">Open Workspace</p>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-secondary transition-colors"
          >
            <CloseIcon size={14} />
          </button>
        </div>

        <div className="px-3 py-2 border-b border-border shrink-0 flex items-center gap-2">
          <button
            type="button"
            disabled={listing === null || listing.parent === null || loading}
            onClick={() => {
              if (listing === null || listing.parent === null) return;
              haptics.tap();
              void load(listing.parent);
            }}
            aria-label="Go up"
            className="p-1 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-secondary transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ArrowUp size={14} />
          </button>
          <p className="text-[11px] font-mono text-text-secondary truncate">
            {listing ? (isWindowsDrivesListing(listing.path) ? "Drives" : listing.path) : ""}
          </p>
        </div>

        <div className="overflow-y-auto flex-1 min-h-0 px-2 py-1">
          {error && (
            <div className="mx-1 my-2 px-2.5 py-2 rounded-md bg-error/10 text-error text-[11px]">
              {error}
            </div>
          )}
          {loading && !listing ? (
            <div className="flex items-center justify-center py-10 text-text-muted">
              <Spinner />
            </div>
          ) : (
            (listing?.entries ?? []).map((entry) => (
              <button
                key={entry.path}
                type="button"
                onClick={() => {
                  haptics.tap();
                  void load(entry.path);
                }}
                className="w-full text-left px-2.5 py-2 rounded-md text-[12px] text-text-secondary hover:text-text hover:bg-bg-hover transition-colors truncate"
              >
                {entry.name}
              </button>
            ))
          )}
          {listing && listing.entries.length === 0 && !loading && (
            <p className="text-[12px] text-text-muted text-center py-8">No folders</p>
          )}
        </div>

        <div className="px-3 py-2.5 border-t border-border shrink-0 space-y-2">
          {creating ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void handleMkdir();
              }}
            >
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Folder name"
                aria-label="New folder name"
                className="flex-1 px-2.5 py-1.5 rounded-md bg-bg-surface border border-border text-[12px] text-text placeholder:text-text-muted/50 focus:outline-none focus:border-text-muted"
              />
              <button
                type="submit"
                className="px-2.5 py-1.5 rounded-md text-[12px] text-text bg-bg-active hover:bg-bg-hover transition-colors"
              >
                Create
              </button>
            </form>
          ) : (
            <button
              type="button"
              disabled={!canCreate}
              onClick={() => {
                haptics.tap();
                setCreating(true);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[12px] text-text-muted hover:text-text-secondary hover:bg-bg-hover transition-colors disabled:opacity-30"
            >
              <PlusIcon />
              New folder
            </button>
          )}
          <button
            type="button"
            disabled={!canOpen || opening}
            onClick={() => void handleOpen()}
            className="w-full px-2.5 py-2 rounded-md text-[12px] font-medium text-bg bg-accent hover:opacity-90 transition-opacity disabled:opacity-30"
          >
            {opening ? "Opening…" : "Open"}
          </button>
        </div>
      </div>
    </div>
  );
}
