/** Location hash used to reopen a Session in a Workspace after reload. */

export function parseSessionHash(hash: string): { sessionId: string | null; workspace: string | null } {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return { sessionId: null, workspace: null };

  const params = new URLSearchParams(raw);
  const sessionId = params.get("session");
  const workspace = params.get("workspace");
  return {
    sessionId: sessionId && /^[a-f0-9-]+$/i.test(sessionId) ? sessionId : null,
    workspace: workspace || null,
  };
}

export function buildSessionHash(opts: {
  sessionId?: string | null;
  workspace?: string | null;
}): string {
  const params = new URLSearchParams();
  if (opts.sessionId) params.set("session", opts.sessionId);
  if (opts.workspace) params.set("workspace", opts.workspace);
  const qs = params.toString();
  return qs ? `#${qs}` : "";
}

export function replaceSessionHash(opts: {
  sessionId?: string | null;
  workspace?: string | null;
}): void {
  if (typeof window === "undefined") return;
  const hash = buildSessionHash(opts);
  const next = `${window.location.pathname}${window.location.search}${hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (current === next) return;
  history.replaceState(null, "", next);
}
