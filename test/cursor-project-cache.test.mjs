import assert from "node:assert/strict";
import { test } from "node:test";
import pathWin32 from "node:path/win32";
import { listCursorCacheWorkspaces, projectKeyToWorkspace } from "../src/lib/cursor-project-cache.mjs";

function winFs(directories) {
  const dirs = new Set(directories);
  return {
    sep: pathWin32.sep,
    existsSync: (p) => dirs.has(p),
    statSync: (p) => ({
      isDirectory: () => dirs.has(p),
    }),
  };
}

test("projectKeyToWorkspace decodes a lowercase Windows drive key", () => {
  const fs = winFs(["d:\\", "d:\\dev", "d:\\dev\\cursor-local-remote"]);
  assert.equal(
    projectKeyToWorkspace("d-dev-cursor-local-remote", fs),
    "d:\\dev\\cursor-local-remote",
  );
});

test("projectKeyToWorkspace prefers a hyphenated folder over a missing shorter segment", () => {
  const fs = winFs(["d:\\", "d:\\dev", "d:\\dev\\runelite-fitman-mode"]);
  assert.equal(
    projectKeyToWorkspace("d-dev-runelite-fitman-mode", fs),
    "d:\\dev\\runelite-fitman-mode",
  );
});

test("projectKeyToWorkspace walks into a nested folder when that path exists", () => {
  const fs = winFs(["d:\\", "d:\\dev", "d:\\dev\\rs3", "d:\\dev\\rs3\\Watchdog"]);
  assert.equal(projectKeyToWorkspace("d-dev-rs3-Watchdog", fs), "d:\\dev\\rs3\\Watchdog");
});

test("projectKeyToWorkspace returns null for non-path Cursor cache folders", () => {
  const fs = winFs(["d:\\"]);
  assert.equal(projectKeyToWorkspace("1785109311443", fs), null);
  assert.equal(projectKeyToWorkspace("empty-window", fs), null);
});

test("listCursorCacheWorkspaces includes lowercase drive keys and skips Temp leftovers", () => {
  const projectsDir = "C:\\users\\me\\.cursor\\projects";
  const realWorkspace = "d:\\dev\\cursor-local-remote";
  const dirs = new Set([
    `${projectsDir}\\d-dev-cursor-local-remote\\agent-transcripts`,
    `${projectsDir}\\D-Temp-aaaa\\agent-transcripts`,
    "d:\\",
    "d:\\dev",
    realWorkspace,
  ]);
  const listed = listCursorCacheWorkspaces({
    projectsDir,
    sep: pathWin32.sep,
    readdirSync: () => [
      "d-dev-cursor-local-remote",
      "D-Temp-aaaa",
      "1785109311443",
      "empty-window",
    ],
    existsSync: (p) => dirs.has(p),
    statSync: (p) => ({ isDirectory: () => dirs.has(p) }),
  });

  assert.deepEqual(
    listed.map((w) => w.key),
    ["d-dev-cursor-local-remote"],
  );
  assert.equal(listed[0].path, realWorkspace);
  assert.equal(listed[0].name, "cursor-local-remote");
});
