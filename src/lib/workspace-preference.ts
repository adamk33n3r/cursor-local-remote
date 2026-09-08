import { sameWorkspacePath } from "./merge-known-workspaces.mjs";

/** Client preference for which Workspace the Sessions dropdown shows. */
export const WORKSPACE_STORAGE_KEY = "clr-selected-project";

/**
 * Prefer the stored dropdown Workspace when it still exists. Start directory
 * is only the fallback when nothing is stored, or that Workspace is gone.
 */
export function resolveSelectedWorkspace(
  stored: string | null,
  list: Array<{ path: string }>,
  startDirectory: string,
  pathInsensitive: boolean,
): string {
  if (stored === "__all__") return "__all__";
  if (stored) {
    const match = list.find((w) => sameWorkspacePath(w.path, stored, pathInsensitive));
    if (match) return match.path;
  }
  return startDirectory;
}

/**
 * Query string for GET /api/sessions. Null means the Workspace filter is not
 * known yet — callers must not hit the endpoint (bare GET means Start directory).
 */
export function sessionsListSearch(
  selected: string | null,
  archived = false,
): string | null {
  if (selected == null || selected === "") return null;
  const params = new URLSearchParams();
  if (selected === "__all__") params.set("all", "true");
  else params.set("workspace", selected);
  if (archived) params.set("archived", "true");
  return params.toString();
}
