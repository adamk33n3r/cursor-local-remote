#!/usr/bin/env node

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getLanIp } from "../lib/lan-ip.mjs";
import { register } from "tsx/esm/api";

// Node cannot load TypeScript until tsx is registered. ESM static imports are
// hoisted, so listenWithNext stays as a top-level dynamic import.
register();
const { listenWithNext } = await import("../lib/listen-with-next.ts");

const DEFAULT_PORT = 3200;
const DEFAULT_BIND = "0.0.0.0";

function parseArgs(argv) {
  let rawPort = process.env.PORT || String(DEFAULT_PORT);
  // Bind default is LAN-wide. Do not inherit HOST from the environment: that
  // var is the Host's Next listen address and would silently loopback the Relay.
  let bind = DEFAULT_BIND;
  let configPath = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port" || a === "-p") {
      rawPort = argv[++i] || rawPort;
    } else if (a === "--host") {
      bind = argv[++i] || bind;
    } else if (a === "--config") {
      configPath = argv[++i] || configPath;
    } else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else if (a === "--version" || a === "-V") {
      const pkg = JSON.parse(
        readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"),
      );
      console.log(pkg.version);
      process.exit(0);
    }
  }
  const port = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`  Error: invalid port: ${rawPort}`);
    process.exit(1);
  }
  return { port, bind, configPath };
}

function printHelp() {
  console.log(`
  Cursor Remote Relay

  Usage:
    cursor-remote-relay [options]

  Options:
    -p, --port     Port to listen on (default: 3200)
    --host         Bind address (default: 0.0.0.0)
    --config       JSON file with Login username and password
    -V, --version  Show version number
    -h, --help     Show this help

  Login (required to serve the Host list):
    LOGIN_USERNAME / LOGIN_PASSWORD environment variables, or a --config file:

      { "username": "user", "password": "secret" }
`);
}

function loginFromConfig(configPath) {
  if (!configPath) return null;
  let raw;
  try {
    raw = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`  Error: cannot read Login config ${configPath}: ${message}`);
    process.exit(1);
  }
  const username = typeof raw.username === "string" ? raw.username : "";
  const password = typeof raw.password === "string" ? raw.password : "";
  if (!username || !password) return null;
  return { username, password };
}

function resolveLogin(configPath) {
  const fromEnv = {
    username: process.env.LOGIN_USERNAME ?? "",
    password: process.env.LOGIN_PASSWORD ?? "",
  };
  if (fromEnv.username && fromEnv.password) return fromEnv;
  return loginFromConfig(configPath);
}

function listenPlain(port, bind, handler) {
  const server = createServer(handler);
  server.on("error", (err) => {
    console.error(`  Error: ${err.message}`);
    process.exit(1);
  });
  return new Promise((resolve) => {
    server.listen(port, bind, () => resolve(server));
  });
}

const { port, bind, configPath } = parseArgs(process.argv.slice(2));
const login = resolveLogin(configPath);
const loopbackOnly = bind === "127.0.0.1" || bind === "localhost";

if (login) {
  process.env.LOGIN_USERNAME = login.username;
  process.env.LOGIN_PASSWORD = login.password;
}

let server;
if (!login) {
  server = await listenPlain(port, bind, (_req, res) => {
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Host list is not served until Login credentials are set.\n");
  });
} else {
  try {
    server = await listenWithNext(port, bind);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`  Error: ${message}`);
    process.exit(1);
  }
}

const lanIp = loopbackOnly ? null : await getLanIp();
const localUrl = `http://localhost:${port}`;
const networkUrl = lanIp ? `http://${lanIp}:${port}` : null;

console.log("");
console.log("  Cursor Remote Relay");
console.log(`  Local:    ${localUrl}`);
if (networkUrl) {
  console.log(`  Network:  ${networkUrl}`);
}
console.log("");
if (!login) {
  console.log("  Host list will not be served until Login credentials are set.");
  console.log("");
}
console.log("  Press Ctrl+C to stop");
console.log("");

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
