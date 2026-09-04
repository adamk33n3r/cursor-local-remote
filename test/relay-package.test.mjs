import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const relayPkgPath = join(root, "packages", "cursor-remote-relay", "package.json");

test("Relay is a separate package without the Host Next.js tarball", () => {
  const relay = JSON.parse(readFileSync(relayPkgPath, "utf8"));
  assert.equal(relay.name, "@adamk33n3r/cursor-remote-relay");
  assert.deepEqual(Object.keys(relay.bin), ["cursor-remote-relay"]);
  assert.equal(relay.bin["cursor-remote-relay"], "./bin/cursor-remote-relay.mjs");
  const files = relay.files ?? [];
  assert.equal(files.some((f) => String(f).includes(".next")), false);
  assert.equal("next" in (relay.dependencies ?? {}), false);
});
