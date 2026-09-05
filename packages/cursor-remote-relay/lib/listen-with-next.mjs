import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "node:url";
import next from "next";
import { isAuthedCookie, LOGIN_COOKIE, loginFromEnv, parseCookies } from "./login.mjs";

const relayRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Login gate in Node. Next Edge middleware inlines env at build, so CLI
 * credentials would be missing there. True means the response is already sent.
 */
async function gate(req, res) {
  const login = loginFromEnv();
  if (!login) {
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Host list is not served until Login credentials are set.\n");
    return true;
  }

  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const pathname = url.pathname;
  if (pathname.startsWith("/_next/") || pathname === "/favicon.ico") {
    return false;
  }

  const cookies = parseCookies(req.headers.cookie);
  const authed = await isAuthedCookie(cookies[LOGIN_COOKIE], login);
  const method = req.method ?? "GET";

  if (method === "POST" && (pathname === "/login" || pathname === "/logout")) {
    return false;
  }
  if (pathname === "/") {
    if (authed) {
      res.writeHead(302, { Location: "/hosts" });
      res.end();
      return true;
    }
    return false;
  }
  if (
    !authed &&
    (pathname === "/hosts" || pathname === "/api/hosts" || pathname.startsWith("/api/hosts/"))
  ) {
    if (pathname.startsWith("/api/")) {
      res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return true;
    }
    res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8" });
    res.end();
    return true;
  }
  return false;
}

/**
 * @param {number} port
 * @param {string} bind
 */
export async function listenWithNext(port, bind) {
  const isBuilt = existsSync(join(relayRoot, ".next", "BUILD_ID"));
  if (isBuilt && !process.env.NODE_ENV) {
    process.env.NODE_ENV = "production";
  }
  const app = next({
    dev: !isBuilt,
    hostname: bind,
    port,
    dir: relayRoot,
  });
  await app.prepare();
  const handle = app.getRequestHandler();
  const server = createServer((req, res) => {
    void gate(req, res)
      .then((handled) => {
        if (handled) return;
        const parsed = parse(req.url ?? "/", true);
        void handle(req, res, parsed);
      })
      .catch((err) => {
        if (res.headersSent) return;
        const message = err instanceof Error ? err.message : String(err);
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(message);
      });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, bind, () => resolve());
  });
  return server;
}
