#!/usr/bin/env node

import { createServer } from "http";
import { existsSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { parse } from "url";
import next from "next";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

const isStart = process.argv.includes("--start");
const dev = !isStart;
const hostname = process.env.HOST || "0.0.0.0";
const port = parseInt(process.env.PORT || "3100", 10);

if (isStart && !process.env.NODE_ENV) {
  process.env.NODE_ENV = "production";
}

// Live WebSockets and SIGTERM cleanup belong on this custom server, not Next
// instrumentation (that hook is for telemetry). Load before prepare() so Next
// boot cannot skip them.
if (dev) {
  const { register } = await import("tsx/esm/api");
  register();
  await import("../src/lib/register-host-runtime.ts");
} else {
  const bundled = resolve(projectRoot, "dist/register-host-runtime.js");
  if (!existsSync(bundled)) {
    throw new Error("compiled Host runtime missing (dist/register-host-runtime.js). Run npm run build.");
  }
  await import("../dist/register-host-runtime.js");
}

const app = next({ dev, hostname, port, dir: projectRoot });
// Must be set before the first getRequestHandler() call. Next otherwise
// attaches a catch-all `upgrade` listener on req.socket.server.
app.didWebSocketSetup = true;
await app.prepare();
app.didWebSocketSetup = true;

const handle = app.getRequestHandler();
// NextCustomServer.getUpgradeHandler() is next-server.handleUpgrade, which is a
// no-op. The router-server handler that actually runs webpack HMR is the
// `upgradeHandler` getter. A hanging HMR handshake blocks the browser from
// starting any other WebSocket to this origin (terminal, session watch).
const nextUpgrade = app.upgradeHandler;

const attach = globalThis.__attachLiveWebSockets;
const handleLiveHttp = globalThis.__handleLiveHttpRequest;
if (typeof attach !== "function" || typeof handleLiveHttp !== "function") {
  throw new Error("Host live streams failed to register");
}

const server = createServer((req, res) => {
  if (handleLiveHttp(req, res)) return;
  const parsed = parse(req.url ?? "/", true);
  void handle(req, res, parsed);
});

attach(server, (req, socket, head) => {
  void nextUpgrade(req, socket, head);
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, hostname, () => resolve());
});

console.log(`Ready on http://${hostname}:${port}`);
