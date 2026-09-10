import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const relayPkgPath = join(root, "packages", "cursor-remote-relay", "package.json");

test("Relay is a separate package without the Host Next.js tarball", () => {
  const relay = JSON.parse(readFileSync(relayPkgPath, "utf8"));
  const host = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(relay.name, "@adamk33n3r/cursor-remote-relay");
  assert.deepEqual(Object.keys(relay.bin), ["cursor-remote-relay"]);
  assert.equal(relay.bin["cursor-remote-relay"], "./bin/cursor-remote-relay.mjs");
  assert.equal(host.name, "@adamk33n3r/cursor-remote");
  assert.equal("@adamk33n3r/cursor-remote" in (relay.dependencies ?? {}), false);
});

test("published packages ship compiled JS, not TypeScript source or tsx", () => {
  const relay = JSON.parse(readFileSync(relayPkgPath, "utf8"));
  const host = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal("tsx" in (host.dependencies ?? {}), false);
  assert.equal("tsx" in (relay.dependencies ?? {}), false);
  assert.ok(host.files.includes("dist/"));
  assert.ok(relay.files.includes("dist/"));
  assert.equal(host.files.includes("src/"), false);
  assert.equal(relay.files.includes("src/"), false);
  assert.equal(relay.files.includes("lib/"), false);
  assert.equal(host.scripts.dev, "node bin/cursor-remote.mjs --dev");
  assert.equal(host.scripts.start, "node bin/cursor-remote.mjs --start");
  assert.equal(relay.scripts.dev, "node bin/cursor-remote-relay.mjs --dev");
  assert.equal(relay.scripts.start, "node bin/cursor-remote-relay.mjs --start");
});
