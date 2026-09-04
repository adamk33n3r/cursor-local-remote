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
  });
  assert.ok("workspaces" in payload);
  assert.equal("projects" in payload, false);
  assert.equal(payload.workspaces.length, 1);
  assert.deepEqual(Object.keys(payload.workspaces[0]).sort(), ["key", "name", "path"]);
});
