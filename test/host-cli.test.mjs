import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const cli = join(root, "bin", "cursor-remote.mjs");

test("published Host package name is @adamk33n3r/cursor-remote", () => {
  assert.equal(pkg.name, "@adamk33n3r/cursor-remote");
});

test("Host command is cursor-remote with no clr or cr alias", () => {
  assert.deepEqual(Object.keys(pkg.bin), ["cursor-remote"]);
  assert.equal(pkg.bin["cursor-remote"], "./bin/cursor-remote.mjs");
  assert.equal(pkg.bin.clr, undefined);
  assert.equal(pkg.bin.cr, undefined);
});

test("CLI help says Cursor Remote and Workspace, never CLR or Project type", () => {
  const result = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const out = result.stdout;
  assert.match(out, /Cursor Remote/);
  assert.match(out, /cursor-remote/);
  assert.match(out, /Workspace/);
  assert.doesNotMatch(out, /\bCLR\b/);
  assert.doesNotMatch(out, /\bclr\b/);
  assert.doesNotMatch(out, /\bcr\b/);
  assert.doesNotMatch(out, /project/i);
});

test("CLI --list copy says workspaces, not projects", () => {
  const emptyHome = join(root, "test", "fixtures", "empty-home");
  const result = spawnSync(process.execPath, [cli, "--list"], {
    encoding: "utf8",
    env: { ...process.env, HOME: emptyHome, USERPROFILE: emptyHome },
  });
  assert.equal(result.status, 0, result.stderr);
  const out = result.stdout;
  assert.match(out, /workspace/i);
  assert.doesNotMatch(out, /project/i);
});
