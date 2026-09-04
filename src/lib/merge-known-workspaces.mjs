/**
 * Stock known-Workspace merge: Cursor projects cache + Host session store + Start directory.
 * Does not crawl the disk for folders.
 *
 * @param {{
 *   fromCursorCache: Array<{ name: string, path: string, key?: string }>,
 *   fromSessionStore: string[],
 *   startDirectory: string,
 * }} sources
 * @returns {{
 *   workspaces: Array<{ name: string, path: string, key: string }>,
 *   currentWorkspace: string,
 * }}
 */
export function mergeKnownWorkspaces({ fromCursorCache, fromSessionStore, startDirectory }) {
  const byPath = new Map();

  for (const item of fromCursorCache) {
    byPath.set(item.path, {
      name: item.name,
      path: item.path,
      key: item.key ?? item.path,
    });
  }

  for (const workspacePath of fromSessionStore) {
    if (byPath.has(workspacePath)) continue;
    byPath.set(workspacePath, {
      name: folderName(workspacePath),
      path: workspacePath,
      key: workspacePath,
    });
  }

  if (!byPath.has(startDirectory)) {
    byPath.set(startDirectory, {
      name: folderName(startDirectory),
      path: startDirectory,
      key: startDirectory,
    });
  }

  const workspaces = Array.from(byPath.values()).sort((a, b) => a.name.localeCompare(b.name));
  return { workspaces, currentWorkspace: startDirectory };
}

function folderName(workspacePath) {
  const parts = workspacePath.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || workspacePath;
}
