/**
 * Stock known-Workspace merge: Cursor projects cache + Host session store + Start directory.
 * Does not crawl the disk for folders.
 *
 * @param {string} workspacePath
 * @param {boolean} caseInsensitive
 * @returns {string}
 */
export function workspacePathIdentity(workspacePath, caseInsensitive) {
  let normalized = String(workspacePath);
  if (caseInsensitive) {
    // Windows: the whole path is one folder, not just the drive letter.
    normalized = normalized.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  }
  return normalized;
}

/**
 * @param {string} a
 * @param {string} b
 * @param {boolean} caseInsensitive
 * @returns {boolean}
 */
export function sameWorkspacePath(a, b, caseInsensitive) {
  return workspacePathIdentity(a, caseInsensitive) === workspacePathIdentity(b, caseInsensitive);
}

/**
 * @param {{
 *   fromCursorCache: Array<{ name: string, path: string, key?: string }>,
 *   fromSessionStore: string[],
 *   startDirectory: string,
 *   caseInsensitive?: boolean,
 * }} sources
 * @returns {{
 *   workspaces: Array<{ name: string, path: string, key: string }>,
 *   currentWorkspace: string,
 *   pathInsensitive: boolean,
 * }}
 */
export function mergeKnownWorkspaces({
  fromCursorCache,
  fromSessionStore,
  startDirectory,
  caseInsensitive = process.platform === "win32",
}) {
  const byId = new Map();

  function add(item) {
    const id = workspacePathIdentity(item.path, caseInsensitive);
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, {
        name: item.name,
        path: item.path,
        key: item.key ?? item.path,
      });
      return;
    }

    const startId = workspacePathIdentity(startDirectory, caseInsensitive);
    const useStartPath = id === startId;
    const cacheKey =
      existing.key !== existing.path
        ? existing.key
        : item.key && item.key !== item.path
          ? item.key
          : existing.key;

    byId.set(id, {
      name: useStartPath ? folderName(startDirectory) : existing.name,
      path: useStartPath ? startDirectory : existing.path,
      key: cacheKey,
    });
  }

  for (const item of fromCursorCache) {
    add({
      name: item.name,
      path: item.path,
      key: item.key ?? item.path,
    });
  }

  for (const workspacePath of fromSessionStore) {
    add({
      name: folderName(workspacePath),
      path: workspacePath,
      key: workspacePath,
    });
  }

  add({
    name: folderName(startDirectory),
    path: startDirectory,
    key: startDirectory,
  });

  const workspaces = Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  const current = byId.get(workspacePathIdentity(startDirectory, caseInsensitive));
  return {
    workspaces,
    currentWorkspace: current?.path ?? startDirectory,
    pathInsensitive: caseInsensitive,
  };
}

function folderName(workspacePath) {
  const parts = workspacePath.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || workspacePath;
}
