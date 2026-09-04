#!/usr/bin/env node

import { createServer } from "http";
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

const app = next({ dev, hostname, port, dir: projectRoot });
await app.prepare();

const handle = app.getRequestHandler();
const nextUpgrade = app.getUpgradeHandler();
// Next's request handler would otherwise attach a catch-all upgrade
// listener on first HTTP request, racing our live-stream upgrades.
app.didWebSocketSetup = true;

const attach = globalThis.__attachLiveWebSockets;
const handleLiveHttp = globalThis.__handleLiveHttpRequest;
if (typeof attach !== "function" || typeof handleLiveHttp !== "function") {
  throw new Error("Host live streams failed to register during Next prepare");
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
