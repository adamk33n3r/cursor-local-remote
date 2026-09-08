import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "node:url";
import next from "next";
import { isAuthedCookie, LOGIN_COOKIE, clearPickCookieHeader, loginFromEnv, parseCookies, PICK_COOKIE } from "./login";
import { forgetHost, forgetHttp, listHosts } from "./hosts";
import { originFromRequestHeaders, urlOnRequestOrigin } from "./request-origin";
import { attachTunnel, proxyHostHttp } from "./tunnel";
import { hostPickNextPath } from "./host-pick";
import type { UpgradeHandler } from "./tunnel";

const relayRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

type NextWithUpgrade = ReturnType<typeof next> & {
  didWebSocketSetup?: boolean;
  upgradeHandler?: UpgradeHandler;
};

function locationOnRequestOrigin(req: IncomingMessage, value: string): string {
  const origin = originFromRequestHeaders(req.headers);
  if (!origin) {
    if (value.startsWith("/") && !value.startsWith("//")) return value;
    try {
      const url = new URL(value);
      return `${url.pathname}${url.search}${url.hash}` || "/";
    } catch {
      return value;
    }
  }
  try {
    let path = value;
    if (!value.startsWith("/") || value.startsWith("//")) {
      const url = new URL(value);
      path = `${url.pathname}${url.search}${url.hash}` || "/";
    }
    return urlOnRequestOrigin(req.headers, path);
  } catch {
    return value;
  }
}

function rewriteLocationValue(
  req: IncomingMessage,
  value: number | string | readonly string[],
): number | string | readonly string[] {
  if (typeof value === "string") return locationOnRequestOrigin(req, value);
  if (Array.isArray(value)) {
    return value.map((item) =>
      typeof item === "string" ? locationOnRequestOrigin(req, item) : item,
    );
  }
  return value;
}

/**
 * Next rewrites Location against its listen hostname. Put the Client's Host
 * (or forwarded host) back so a domain / reverse proxy never sees 0.0.0.0.
 */
function attachRequestOriginRedirects(req: IncomingMessage, res: ServerResponse): void {
  const originalSetHeader = res.setHeader.bind(res);
  res.setHeader = ((name: string, value: number | string | readonly string[]) => {
    if (name.toLowerCase() === "location") {
      return originalSetHeader(name, rewriteLocationValue(req, value));
    }
    return originalSetHeader(name, value);
  }) as typeof res.setHeader;

  const originalAppend = res.appendHeader.bind(res);
  res.appendHeader = ((name: string, value: string | readonly string[]) => {
    if (name.toLowerCase() === "location") {
      return originalAppend(name, rewriteLocationValue(req, value) as string | readonly string[]);
    }
    return originalAppend(name, value);
  }) as typeof res.appendHeader;
}

/**
 * Login gate in Node. Next Edge middleware inlines env at build, so CLI
 * credentials would be missing there. True means the response is already sent.
 */
async function gate(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const login = loginFromEnv();
  if (!login) {
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Host list is not served until Login credentials are set.\n");
    return true;
  }

  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const pathname = url.pathname;
  const cookies = parseCookies(req.headers.cookie);
  if (
    (pathname.startsWith("/_next/") || pathname === "/favicon.ico") &&
    !cookies[PICK_COOKIE]
  ) {
    return false;
  }

  const authed = await isAuthedCookie(cookies[LOGIN_COOKIE], login);
  const method = req.method ?? "GET";

  if (method === "POST" && (pathname === "/login" || pathname === "/logout")) {
    return false;
  }
  if (pathname === "/") {
    if (authed) {
      res.writeHead(302, { Location: urlOnRequestOrigin(req.headers, "/hosts") });
      res.end();
      return true;
    }
    return false;
  }
  if (
    !authed &&
    (pathname === "/hosts" ||
      pathname === "/api/hosts" ||
      pathname.startsWith("/api/hosts/") ||
      pathname.startsWith("/h/"))
  ) {
    if (pathname.startsWith("/api/")) {
      res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return true;
    }
    const next = hostPickNextPath(pathname);
    if (next && method === "GET") {
      res.writeHead(302, {
        Location: urlOnRequestOrigin(req.headers, `/?next=${encodeURIComponent(next)}`),
      });
      res.end();
      return true;
    }
    res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8" });
    res.end();
    return true;
  }
  if (authed && method === "GET" && pathname === "/api/hosts") {
    // Same process as Registration. Next's /api/hosts route cannot see that Map.
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ hosts: listHosts() }));
    return true;
  }
  if (authed && method === "POST") {
    const forgetMatch = /^\/api\/hosts\/([^/]+)\/forget$/.exec(pathname);
    if (forgetMatch) {
      const hostId = decodeURIComponent(forgetMatch[1]);
      const outcome = forgetHttp(forgetHost(hostId));
      if (outcome.status !== 204) {
        res.writeHead(outcome.status, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(outcome.body);
        return true;
      }
      const pick = parseCookies(req.headers.cookie)[PICK_COOKIE];
      if (pick && decodeURIComponent(pick) === hostId) {
        res.writeHead(204, { "Set-Cookie": clearPickCookieHeader() });
      } else {
        res.writeHead(204);
      }
      res.end();
      return true;
    }
  }
  return false;
}

export async function listenWithNext(port: number, bind: string): Promise<Server> {
  const isBuilt = existsSync(join(relayRoot, ".next", "BUILD_ID"));
  if (isBuilt && !process.env.NODE_ENV) {
    Reflect.set(process.env, "NODE_ENV", "production");
  }
  const app = next({
    dev: !isBuilt,
    hostname: bind,
    port,
    dir: relayRoot,
  }) as NextWithUpgrade;
  app.didWebSocketSetup = true;
  await app.prepare();
  app.didWebSocketSetup = true;
  const handle = app.getRequestHandler();
  const nextUpgrade = app.upgradeHandler;
  const server = createServer((req, res) => {
    attachRequestOriginRedirects(req, res);
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname === "/hosts") {
      res.appendHeader("Set-Cookie", clearPickCookieHeader());
    }
    void gate(req, res)
      .then(async (handled) => {
        if (handled) return;
        if (await proxyHostHttp(req, res)) return;
        const parsed = parse(req.url ?? "/", true);
        void handle(req, res, parsed);
      })
      .catch((err: unknown) => {
        if (res.headersSent) return;
        const message = err instanceof Error ? err.message : String(err);
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(message);
      });
  });
  attachTunnel(server, nextUpgrade);
  const rawOn = server.on.bind(server);
  const rawAddListener = server.addListener.bind(server);
  const rawPrepend = server.prependListener.bind(server);
  const ignoreForeignUpgrade = (
    original: typeof server.on,
    event: string | symbol,
    listener: (...args: unknown[]) => void,
  ): Server => {
    if (event === "upgrade") return server;
    return original.call(server, event, listener);
  };
  server.on = ((event: string | symbol, listener: (...args: unknown[]) => void) =>
    ignoreForeignUpgrade(rawOn, event, listener)) as typeof server.on;
  server.addListener = ((event: string | symbol, listener: (...args: unknown[]) => void) =>
    ignoreForeignUpgrade(rawAddListener, event, listener)) as typeof server.addListener;
  server.prependListener = ((event: string | symbol, listener: (...args: unknown[]) => void) => {
    if (event === "upgrade") return server;
    return rawPrepend.call(server, event, listener);
  }) as typeof server.prependListener;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, bind, () => resolve());
  });
  return server;
}
