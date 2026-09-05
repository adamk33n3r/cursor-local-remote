import { existsSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { join, sep as defaultSep } from "path";

/**
 * Cursor encodes an absolute Workspace as ~/.cursor/projects/<key>/ with
 * separators turned into hyphens. On Windows the drive letter is the first
 * segment and is often lowercase (`D:\dev\foo` → `d-dev-foo`).
 *
 * Folders that are not path encodings (numeric ids, empty-window, leftover
 * D-Temp-* dirs) return null when no matching directory exists.
 *
 * @param {string} key
 * @param {{
 *   existsSync?: (p: string) => boolean,
 *   statSync?: (p: string) => { isDirectory: () => boolean },
 *   sep?: string,
 * }} [fs]
 * @returns {string | null}
 */
export function projectKeyToWorkspace(key, fs = {}) {
  const exists = fs.existsSync ?? existsSync;
  const stat = fs.statSync ?? statSync;
  const sep = fs.sep ?? defaultSep;
  const parts = key.split("-");
  if (!parts[0]) return null;

  let path;
  let i = 0;
  // Single-letter first segment is a Windows drive, not /Users-style Unix.
  if (/^[A-Za-z]$/.test(parts[0])) {
    path = `${parts[0]}:${sep}`;
    i = 1;
  } else {
    path = sep + parts[0];
    i = 1;
  }

  while (i < parts.length) {
    let matched = false;
    // Longest prefix so hyphenated folder names win over a shorter sibling
    // (`d:\dev\cursor-local-remote` over a missing `d:\dev\cursor`).
    for (let take = parts.length - i; take >= 1; take--) {
      const segment = parts.slice(i, i + take).join("-");
      const candidate = path.endsWith(sep) ? path + segment : path + sep + segment;
      if (exists(candidate) && stat(candidate).isDirectory()) {
        path = candidate;
        i += take;
        matched = true;
        break;
      }
    }
    if (!matched) return null;
  }

  return exists(path) ? path : null;
}

function folderName(workspacePath, sep) {
  const parts = workspacePath.split(sep).filter(Boolean);
  return parts[parts.length - 1] || workspacePath;
}

/**
 * Workspaces Cursor already knows about, from ~/.cursor/projects.
 * Requires an agent-transcripts dir and a path that still exists on disk.
 *
 * @param {{
 *   projectsDir?: string,
 *   readdirSync?: (dir: string) => string[],
 *   existsSync?: (p: string) => boolean,
 *   statSync?: (p: string) => { isDirectory: () => boolean },
 *   sep?: string,
 * }} [fs]
 */
export function listCursorCacheWorkspaces(fs = {}) {
  const projectsDir = fs.projectsDir ?? join(homedir(), ".cursor", "projects");
  const readdir = fs.readdirSync ?? readdirSync;
  const exists = fs.existsSync ?? existsSync;
  const stat = fs.statSync ?? statSync;
  const sep = fs.sep ?? defaultSep;
  const workspaces = [];

  try {
    const entries = readdir(projectsDir);
    for (const entry of entries) {
      const transcriptsDir = [projectsDir, entry, "agent-transcripts"].join(sep);
      if (!exists(transcriptsDir)) continue;
      const workspace = projectKeyToWorkspace(entry, { existsSync: exists, statSync: stat, sep });
      if (!workspace) continue;
      workspaces.push({
        name: folderName(workspace, sep),
        path: workspace,
        key: entry,
      });
    }
  } catch {
    // Cursor projects cache is missing or unreadable
  }

  return workspaces.sort((a, b) => a.name.localeCompare(b.name));
}
