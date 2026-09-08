import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { Buffer } from "node:buffer";
import { WebSocket, WebSocketServer } from "ws";
import { isLanSourceIp } from "./source-ip";
import { attachLiveClient, getHost, getOnlineHost, markHostOffline, putHost } from "./hosts";
import { isAuthedCookie, LOGIN_COOKIE, loginFromEnv, parseCookies, pickCookieHeader } from "./login";
import { isCookieLessHostAsset, isHostListLivePath, resolveHostProxy } from "./host-pick";
import { urlOnRequestOrigin } from "./request-origin";
import { RELAY_HOST_ID_HEADER } from "./via-relay";

const TUNNEL_PATH = "/tunnel";
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
]);

type HeaderMap = Record<string, string | string[]>;

type HttpPending = {
  resolve: (msg: TunnelHttpResponse) => void;
};

type WsPending = {
  resolve: () => void;
  client: WebSocket | null;
};

type TunnelPending = {
  http: Map<string, HttpPending>;
  ws: Map<string, WsPending>;
};

type TunnelSocket = WebSocket & { __relayPending?: TunnelPending };

type TunnelHttpResponse = {
  type: "http-response";
  id: string;
  status?: number;
  headers?: HeaderMap;
  body?: string;
};

type TunnelMessage =
  | TunnelHttpResponse
  | { type: "ws-opened"; id: string }
  | { type: "ws-data"; id: string; data?: string; binary?: boolean }
  | { type: "ws-close"; id: string; code?: number; reason?: string };

export type UpgradeHandler = (req: IncomingMessage, socket: Duplex, head: Buffer) => void;

function pathnameOf(req: IncomingMessage): string {
  return new URL(req.url ?? "/", "http://127.0.0.1").pathname;
}

function targetOf(req: IncomingMessage) {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const referer = req.headers.referer;
  return resolveHostProxy(
    url.pathname,
    url.search,
    req.headers.cookie,
    Array.isArray(referer) ? referer[0] : referer,
  );
}

// Close events report 1005/1006; those codes are not legal in a close frame.
function isSendableCloseCode(code: unknown): code is number {
  return (
    typeof code === "number" &&
    Number.isInteger(code) &&
    ((code >= 1000 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006) ||
      (code >= 3000 && code <= 4999))
  );
}

function closeSocket(socket: WebSocket, code?: number, reason?: string): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  const text = typeof reason === "string" && Buffer.byteLength(reason) <= 123 ? reason : "";
  socket.close(isSendableCloseCode(code) ? code : 1000, text);
}

function filterHeaders(headers: IncomingMessage["headers"] | HeaderMap): HeaderMap {
  const out: HeaderMap = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (HOP_BY_HOP.has(key.toLowerCase())) continue;
    out[key] = value;
  }
  return out;
}

function sendJson(ws: WebSocket, value: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(value));
  }
}

function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function pendingMaps(socket: TunnelSocket): TunnelPending {
  if (!socket.__relayPending) {
    socket.__relayPending = {
      http: new Map(),
      ws: new Map(),
    };
  }
  return socket.__relayPending;
}

async function clientIsAuthed(req: IncomingMessage): Promise<boolean> {
  const login = loginFromEnv();
  if (!login) return false;
  const cookies = parseCookies(req.headers.cookie);
  return isAuthedCookie(cookies[LOGIN_COOKIE], login);
}

function rejectSocket(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

function parseTunnelMessage(raw: WebSocket.RawData): TunnelMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || !("type" in parsed)) return null;
  const type = (parsed as { type: unknown }).type;
  switch (type) {
    case "http-response":
    case "ws-opened":
    case "ws-data":
    case "ws-close":
      return parsed as TunnelMessage;
    default:
      return null;
  }
}

function onTunnelMessage(_hostId: string, socket: TunnelSocket, raw: WebSocket.RawData): void {
  const msg = parseTunnelMessage(raw);
  if (!msg) return;
  const pending = pendingMaps(socket);
  switch (msg.type) {
    case "http-response": {
      const waiter = pending.http.get(msg.id);
      if (waiter) {
        pending.http.delete(msg.id);
        waiter.resolve(msg);
      }
      return;
    }
    case "ws-opened": {
      const waiter = pending.ws.get(msg.id);
      if (waiter) waiter.resolve();
      return;
    }
    case "ws-data": {
      const waiter = pending.ws.get(msg.id);
      const client = waiter?.client;
      if (client && client.readyState === WebSocket.OPEN) {
        const data = Buffer.from(msg.data ?? "", "base64");
        client.send(data, { binary: Boolean(msg.binary) });
      }
      return;
    }
    case "ws-close": {
      const waiter = pending.ws.get(msg.id);
      if (waiter?.client && waiter.client.readyState === WebSocket.OPEN) {
        closeSocket(waiter.client, msg.code, msg.reason);
      }
      pending.ws.delete(msg.id);
      return;
    }
    default: {
      const _exhaustive: never = msg;
      return _exhaustive;
    }
  }
}

function failPending(socket: TunnelSocket, reason: string): void {
  const pending = socket.__relayPending;
  if (!pending) return;
  const body = Buffer.from(reason).toString("base64");
  for (const [id, waiter] of pending.http) {
    pending.http.delete(id);
    waiter.resolve({
      type: "http-response",
      id,
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8" },
      body,
    });
  }
  for (const [id, waiter] of pending.ws) {
    pending.ws.delete(id);
    if (waiter.client && waiter.client.readyState === WebSocket.OPEN) {
      closeSocket(waiter.client, 1011, reason);
    }
  }
}

function attachHostSocket(id: string, name: string, socket: TunnelSocket): void {
  putHost(id, name, socket);
  socket.on("message", (raw) => onTunnelMessage(id, socket, raw));
  const drop = (): void => {
    failPending(socket, "Tunnel dropped.\n");
    const row = getOnlineHost(id);
    if (row?.socket === socket) markHostOffline(id);
  };
  socket.on("close", drop);
  socket.on("error", drop);
}

function handleTunnelUpgrade(
  wss: WebSocketServer,
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void {
  const ip = req.socket.remoteAddress;
  if (!isLanSourceIp(ip)) {
    rejectSocket(socket, 403, "Forbidden");
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const timer = setTimeout(() => {
      ws.close(4000, "registration timeout");
    }, 8_000);
    ws.once("message", (raw) => {
      clearTimeout(timer);
      let msg: { type?: unknown; id?: unknown; name?: unknown };
      try {
        msg = JSON.parse(String(raw)) as { type?: unknown; id?: unknown; name?: unknown };
      } catch {
        ws.close(4000, "invalid registration");
        return;
      }
      if (msg.type !== "register" || typeof msg.id !== "string" || typeof msg.name !== "string") {
        ws.close(4000, "invalid registration");
        return;
      }
      if (!msg.id || !msg.name) {
        ws.close(4000, "invalid registration");
        return;
      }
      attachHostSocket(msg.id, msg.name, ws);
      sendJson(ws, { type: "registered", id: msg.id, name: msg.name });
    });
  });
}

function waitForHttpResponse(
  hostSocket: TunnelSocket,
  requestId: string,
  timeoutMs = 30_000,
): Promise<TunnelHttpResponse> {
  const pending = pendingMaps(hostSocket);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.http.delete(requestId);
      reject(new Error("tunnel HTTP timeout"));
    }, timeoutMs);
    pending.http.set(requestId, {
      resolve: (msg) => {
        clearTimeout(timer);
        resolve(msg);
      },
    });
  });
}

function appendSetCookie(headers: HeaderMap, value: string): void {
  const existing = headers["set-cookie"];
  if (existing === undefined) {
    headers["set-cookie"] = value;
    return;
  }
  if (Array.isArray(existing)) {
    headers["set-cookie"] = [...existing, value];
    return;
  }
  headers["set-cookie"] = [existing, value];
}

export async function proxyHostHttp(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const target = targetOf(req);
  if (!target) return false;

  if (!(await clientIsAuthed(req))) {
    const forwardPath = target.forwardUrl.split("?")[0] || "/";
    if (!isCookieLessHostAsset(forwardPath)) {
      res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8" });
      res.end();
      return true;
    }
  }

  const host = getOnlineHost(target.hostId);
  if (!host?.socket) {
    // Pick of an offline Host is not a successful pick. Send the Client back to the list.
    const forwardPath = target.forwardUrl.split("?")[0] || "/";
    if (target.viaPrefix && forwardPath === "/") {
      res.writeHead(302, { Location: urlOnRequestOrigin(req.headers, "/hosts") });
      res.end();
      return true;
    }
    // Forgotten (or never listed): do not retry that Host path. Offline-but-listed
    // is retryable so a tunneled Client can come back when the Tunnel reconnects.
    if (!getHost(target.hostId)) {
      res.writeHead(410, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Host is not on the Host list.\n");
      return true;
    }
    res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Host is not online.\n");
    return true;
  }

  const body = await readRequestBody(req);
  const requestId = randomUUID();
  sendJson(host.socket, {
    type: "http-request",
    id: requestId,
    method: req.method ?? "GET",
    url: target.forwardUrl,
    headers: { ...filterHeaders(req.headers), [RELAY_HOST_ID_HEADER]: target.hostId },
    body: body.length > 0 ? body.toString("base64") : "",
  });

  try {
    const reply = await waitForHttpResponse(host.socket, requestId);
    const headers = filterHeaders(reply.headers ?? {});
    const payload = reply.body ? Buffer.from(reply.body, "base64") : Buffer.alloc(0);
    headers["content-length"] = String(payload.length);
    if (target.viaPrefix) {
      appendSetCookie(headers, pickCookieHeader(target.hostId));
    }
    res.writeHead(Number(reply.status) || 502, headers);
    res.end(payload);
  } catch {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Tunnel request failed.\n");
    }
  }
  return true;
}

function handleHostListLive(
  wss: WebSocketServer,
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void {
  // Finish the 101 immediately. Waiting on Login HMAC first leaves browsers
  // in CONNECTING with no frames until something else times out.
  wss.handleUpgrade(req, socket, head, (clientWs) => {
    void clientIsAuthed(req).then((authed) => {
      if (!authed) {
        clientWs.close(1008, "Unauthorized");
        return;
      }
      attachLiveClient(clientWs);
    });
  });
}

function handleClientWsUpgrade(
  wss: WebSocketServer,
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void {
  const target = targetOf(req);
  if (!target) {
    socket.destroy();
    return;
  }
  const host = getOnlineHost(target.hostId);
  if (!host?.socket) {
    if (!getHost(target.hostId)) {
      rejectSocket(socket, 410, "Gone");
      return;
    }
    rejectSocket(socket, 502, "Bad Gateway");
    return;
  }
  const hostSocket = host.socket;

  void clientIsAuthed(req).then((authed) => {
    if (!authed) {
      rejectSocket(socket, 401, "Unauthorized");
      return;
    }
    const channelId = randomUUID();
    const forwardUrl = target.forwardUrl;
    const pending = pendingMaps(hostSocket);
    let opened = false;
    const timer = setTimeout(() => {
      if (opened) return;
      pending.ws.delete(channelId);
      rejectSocket(socket, 504, "Gateway Timeout");
    }, 8_000);

    const onOpened = (): void => {
      if (opened) return;
      opened = true;
      clearTimeout(timer);
      wss.handleUpgrade(req, socket, head, (clientWs) => {
        const entry = pending.ws.get(channelId);
        if (entry) entry.client = clientWs;
        clientWs.on("message", (data, isBinary) => {
          const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
          sendJson(hostSocket, {
            type: "ws-data",
            id: channelId,
            data: buf.toString("base64"),
            binary: Boolean(isBinary),
          });
        });
        clientWs.on("close", (code, reason) => {
          sendJson(hostSocket, {
            type: "ws-close",
            id: channelId,
            code,
            reason: String(reason ?? ""),
          });
          pending.ws.delete(channelId);
        });
      });
    };

    pending.ws.set(channelId, { resolve: onOpened, client: null });
    sendJson(hostSocket, {
      type: "ws-open",
      id: channelId,
      url: forwardUrl,
      headers: filterHeaders(req.headers),
    });
  });
}

export function attachTunnel(server: Server, fallbackUpgrade?: UpgradeHandler): void {
  const wss = new WebSocketServer({ noServer: true });
  server.prependListener("upgrade", (req, socket, head) => {
    const pathname = pathnameOf(req);
    if (pathname === TUNNEL_PATH) {
      handleTunnelUpgrade(wss, req, socket, head);
      return;
    }
    if (isHostListLivePath(pathname)) {
      handleHostListLive(wss, req, socket, head);
      return;
    }
    if (pathname === "/api/hosts" || pathname.startsWith("/api/hosts/")) {
      rejectSocket(socket, 404, "Not Found");
      return;
    }
    if (targetOf(req)) {
      handleClientWsUpgrade(wss, req, socket, head);
      return;
    }
    if (fallbackUpgrade) {
      fallbackUpgrade(req, socket, head);
      return;
    }
    socket.destroy();
  });
}
