#!/usr/bin/env node

import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const relayRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const distLanIp = join(relayRoot, "dist/lan-ip.js");
const srcLanIp = join(relayRoot, "lib/lan-ip.ts");
const buildIdPath = join(relayRoot, ".next", "BUILD_ID");

const DEFAULT_PORT = 3200;
const DEFAULT_BIND = "0.0.0.0";

function fail(message) {
  console.error(`  Error: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  let rawPort = process.env.PORT || String(DEFAULT_PORT);
  // Bind default is LAN-wide. Do not inherit HOST from the environment: that
  // var is the Host's Next listen address and would silently loopback the Relay.
  let bind = DEFAULT_BIND;
  let configPath = null;
  let forceDev = false;
  let forceStart = false;
  let loginChoice = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port" || a === "-p") {
      rawPort = argv[++i] || rawPort;
    } else if (a === "--host") {
      bind = argv[++i] || bind;
    } else if (a === "--config") {
      configPath = argv[++i] || configPath;
    } else if (a === "--login") {
      loginChoice = argv[++i] || loginChoice;
    } else if (a === "--dev") {
      forceDev = true;
    } else if (a === "--start") {
      forceStart = true;
    } else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else if (a === "--version" || a === "-V") {
      const pkg = JSON.parse(readFileSync(join(relayRoot, "package.json"), "utf8"));
      console.log(pkg.version);
      process.exit(0);
    }
  }
  const port = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`  Error: invalid port: ${rawPort}`);
    process.exit(1);
  }
  if (forceDev && forceStart) fail("--dev and --start cannot be used together");
  if (loginChoice !== null && loginChoice !== "none" && loginChoice !== "password") {
    fail(`invalid --login: ${loginChoice} (use none or password)`);
  }
  return { port, bind, configPath, forceDev, forceStart, loginChoice };
}

function printHelp() {
  console.log(`
  Cursor Remote Relay

  Usage:
    cursor-remote-relay [options]

  Options:
    -p, --port     Port to listen on (default: 3200)
    --host         Bind address (default: 0.0.0.0)
    --config       JSON file with Login username, password, and optional login
    --login        none or password (overrides LOGIN_MODE and config login)
    --dev          Force Next development (HMR), even if a build exists
    --start        Require a production build (dist/ + .next)
    -V, --version  Show version number
    -h, --help     Show this help

  Login:
    password — splash Login when both username and password are set
               (LOGIN_USERNAME / LOGIN_PASSWORD, or --config).
    none     — Host list without that Login. Default when credentials are unset.
               Explicit none (--login none, LOGIN_MODE=none, or config
               "login": "none") skips the unsecured warning. Leftover
               credentials are unused. A forward-auth reverse proxy in front
               is optional, not required.

    Explicit password with username or password unset does not serve the
    Host list.

      { "username": "user", "password": "secret" }
      { "login": "none" }
`);
}

function parseLoginChoice(value) {
  if (value === "none" || value === "password") return value;
  return null;
}

function readConfig(configPath) {
  if (!configPath) return { credentials: null, login: null };
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
  const credentials = username && password ? { username, password } : null;
  return { credentials, login: parseLoginChoice(raw.login) };
}

function resolveLogin(configPath) {
  const fromEnv = {
    username: process.env.LOGIN_USERNAME ?? "",
    password: process.env.LOGIN_PASSWORD ?? "",
  };
  const fromFile = readConfig(configPath);
  const credentials =
    fromEnv.username && fromEnv.password ? fromEnv : fromFile.credentials;
  return { credentials, configLogin: fromFile.login };
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

const { port, bind, configPath, forceDev, forceStart, loginChoice } = parseArgs(
  process.argv.slice(2),
);
const isBuilt = existsSync(buildIdPath);
let useTs = false;
if (forceDev) {
  if (!existsSync(srcLanIp)) fail("--dev requires a source checkout");
  useTs = true;
} else if (forceStart) {
  if (!existsSync(distLanIp)) fail("compiled CLI missing (dist/). Run npm run build.");
  if (!isBuilt) fail("Next build missing (.next/BUILD_ID). Run npm run build.");
  useTs = false;
} else if (existsSync(distLanIp)) {
  useTs = false;
} else if (existsSync(srcLanIp)) {
  useTs = true;
} else {
  fail("compiled CLI missing (dist/). Run npm run build.");
}

let listenWithNext;
let getLanIp;
let closeHttpServer;
if (useTs) {
  const { register } = await import("tsx/esm/api");
  register();
  ({ listenWithNext } = await import("../lib/listen-with-next.ts"));
  ({ getLanIp } = await import("../lib/lan-ip.ts"));
  ({ closeHttpServer } = await import("../lib/stop-http.ts"));
} else {
  ({ listenWithNext } = await import("../dist/listen-with-next.js"));
  ({ getLanIp } = await import("../dist/lan-ip.js"));
  ({ closeHttpServer } = await import("../dist/stop-http.js"));
}

const { credentials: login, configLogin } = resolveLogin(configPath);
const loopbackOnly = bind === "127.0.0.1" || bind === "localhost";
const envMode = parseLoginChoice(process.env.LOGIN_MODE);
const explicit = loginChoice ?? envMode ?? configLogin;
const refuseHostList = explicit === "password" && !login;
const warnUnsecured = !login && explicit !== "none" && explicit !== "password";

if (explicit === "none") {
  process.env.LOGIN_MODE = "none";
  delete process.env.LOGIN_USERNAME;
  delete process.env.LOGIN_PASSWORD;
} else if (login) {
  process.env.LOGIN_MODE = "password";
  process.env.LOGIN_USERNAME = login.username;
  process.env.LOGIN_PASSWORD = login.password;
} else if (refuseHostList) {
  process.env.LOGIN_MODE = "password";
  delete process.env.LOGIN_USERNAME;
  delete process.env.LOGIN_PASSWORD;
} else {
  process.env.LOGIN_MODE = "none";
  delete process.env.LOGIN_USERNAME;
  delete process.env.LOGIN_PASSWORD;
}

let server;
if (refuseHostList) {
  server = await listenPlain(port, bind, (_req, res) => {
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Host list is not served until Login credentials are set.\n");
  });
} else {
  try {
    server = await listenWithNext(port, bind, { forceDev, forceStart });
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
if (refuseHostList) {
  console.log("  Host list will not be served until Login credentials are set.");
  console.log("");
} else if (warnUnsecured) {
  console.log("  WARNING: Host list is not secured. Anyone who can reach this origin can see it.");
  console.log("");
}
console.log("  Press Ctrl+C to stop");
console.log("");

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) {
    process.exit(1);
  }
  shuttingDown = true;
  void closeHttpServer(server).finally(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
