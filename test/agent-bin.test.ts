import assert from "node:assert/strict";
import { test } from "node:test";
import pathWin32 from "node:path/win32";
import { pickLatestAgentVersion, resolveAgentBin } from "../src/lib/agent-bin";

test("pickLatestAgentVersion prefers the newest dated Cursor Agent install", () => {
  const latest = pickLatestAgentVersion([
    "2026.08.25-3e8eec8",
    "2026.09.02-c22c1a3",
    "scratch",
  ]);
  assert.equal(latest, "2026.09.02-c22c1a3");
});

test("resolveAgentBin unwraps Windows agent.cmd to versions/node.exe + index.js", () => {
  const home = "C:\\agent-home";
  const latest = pathWin32.join(home, "versions", "2026.09.02-c22c1a3");
  const older = pathWin32.join(home, "versions", "2026.08.25-aaaaaaa");
  const files = new Set([
    pathWin32.join(home, "agent.cmd"),
    pathWin32.join(home, "versions"),
    latest,
    pathWin32.join(latest, "node.exe"),
    pathWin32.join(latest, "index.js"),
    pathWin32.join(older, "node.exe"),
    pathWin32.join(older, "index.js"),
  ]);
  const dirs = new Map<string, string[]>([
    [pathWin32.join(home, "versions"), ["2026.08.25-aaaaaaa", "2026.09.02-c22c1a3"]],
  ]);
  const resolved = resolveAgentBin(
    { PATH: home, LOCALAPPDATA: "C:\\unused" },
    {
      existsSync: (p) => files.has(p),
      readdirSync: (p) => dirs.get(p) ?? [],
    },
    "win32",
  );
  assert.equal(resolved.command, pathWin32.join(latest, "node.exe"));
  assert.deepEqual(resolved.prefixArgs, [pathWin32.join(latest, "index.js")]);
});

test("resolveAgentBin on Windows uses cmd.exe when only agent.cmd exists", () => {
  const resolved = resolveAgentBin(
    { PATH: "C:\\shim", ComSpec: "C:\\Windows\\system32\\cmd.exe", LOCALAPPDATA: "C:\\unused" },
    {
      existsSync: (p) => p === "C:\\shim\\agent.cmd",
      readdirSync: () => [],
    },
    "win32",
  );
  assert.equal(resolved.command, "C:\\Windows\\system32\\cmd.exe");
  assert.deepEqual(resolved.prefixArgs, ["/d", "/s", "/c", "C:\\shim\\agent.cmd"]);
});
