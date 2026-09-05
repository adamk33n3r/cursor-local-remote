import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeKnownWorkspaces } from "../src/lib/merge-known-workspaces.mjs";

test("known Workspace list is the stock merge of cache, session store, and Start directory", () => {
  const cache = [
    { name: "alpha", path: "/ws/alpha", key: "ws-alpha" },
    { name: "beta", path: "/ws/beta", key: "ws-beta" },
  ];
  const { workspaces, currentWorkspace } = mergeKnownWorkspaces({
    fromCursorCache: cache,
    fromSessionStore: ["/ws/beta", "/ws/from-sessions"],
    startDirectory: "/ws/start",
    caseInsensitive: false,
  });

  assert.equal(currentWorkspace, "/ws/start");
  assert.deepEqual(
    workspaces.map((w) => w.path).sort(),
    ["/ws/alpha", "/ws/beta", "/ws/from-sessions", "/ws/start"].sort(),
  );
  const fromSessions = workspaces.find((w) => w.path === "/ws/from-sessions");
  assert.equal(fromSessions.name, "from-sessions");
  const start = workspaces.find((w) => w.path === "/ws/start");
  assert.equal(start.name, "start");
  const beta = workspaces.find((w) => w.path === "/ws/beta");
  assert.equal(beta.key, "ws-beta");
});

test("Workspace list payload uses workspaces, not a Project type", () => {
  const payload = mergeKnownWorkspaces({
    fromCursorCache: [],
    fromSessionStore: [],
    startDirectory: "/start",
    caseInsensitive: false,
  });
  assert.ok("workspaces" in payload);
  assert.equal("projects" in payload, false);
  assert.equal(payload.workspaces.length, 1);
  assert.deepEqual(Object.keys(payload.workspaces[0]).sort(), ["key", "name", "path"]);
});

test("Windows merge folds the whole path, not just the drive letter", () => {
  const payload = mergeKnownWorkspaces({
    fromCursorCache: [
      {
        name: "cursor-local-remote",
        path: "d:\\dev\\cursor-local-remote",
        key: "d-dev-cursor-local-remote",
      },
    ],
    fromSessionStore: ["D:\\dev\\Cursor-Local-Remote"],
    startDirectory: "D:\\dev\\cursor-local-remote",
    caseInsensitive: true,
  });

  assert.equal(payload.workspaces.length, 1);
  assert.equal(payload.pathInsensitive, true);
  assert.equal(payload.currentWorkspace, "D:\\dev\\cursor-local-remote");
  assert.equal(payload.workspaces[0].path, "D:\\dev\\cursor-local-remote");
  assert.equal(payload.workspaces[0].key, "d-dev-cursor-local-remote");
});

test("case-sensitive hosts keep paths that differ only by case", () => {
  const payload = mergeKnownWorkspaces({
    fromCursorCache: [{ name: "App", path: "/ws/App", key: "ws-App" }],
    fromSessionStore: [],
    startDirectory: "/ws/app",
    caseInsensitive: false,
  });

  assert.equal(payload.pathInsensitive, false);
  assert.equal(payload.workspaces.length, 2);
});
