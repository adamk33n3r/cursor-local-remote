import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  isPathInside,
  workspaceToProjectKey,
  workspaceToProjectKeyCandidates,
} from "../src/lib/transcript-reader";

test("workspaceToProjectKey hyphenates a Windows drive path", { skip: process.platform !== "win32" }, () => {
  const key = workspaceToProjectKey("D:\\dev\\cursor-local-remote");
  assert.equal(key.includes("\\"), false);
  assert.equal(key.includes(":"), false);
  assert.equal(key, "D-dev-cursor-local-remote");
});

test("workspaceToProjectKeyCandidates include a lowercase lookup", { skip: process.platform !== "win32" }, () => {
  const keys = workspaceToProjectKeyCandidates("D:\\dev\\cursor-local-remote");
  assert.deepEqual(keys, ["D-dev-cursor-local-remote", "d-dev-cursor-local-remote"]);
});

test("isPathInside accepts a session folder under the transcripts dir", () => {
  const dir = join(homedir(), ".cursor", "projects", "demo", "agent-transcripts");
  const child = join(dir, "3cd455ac-5a55-4770-810d-deefe9a5413b");
  assert.equal(isPathInside(dir, child), true);
  assert.equal(isPathInside(dir, join(homedir(), ".cursor", "projects", "other", "secret.jsonl")), false);
  // The old check used "/" even on Windows, so every real transcript looked like traversal.
  if (process.platform === "win32") {
    assert.equal(child.startsWith(dir + "/"), false);
  }
});
