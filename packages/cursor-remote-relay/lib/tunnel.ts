import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { Buffer } from "node:buffer";
import { WebSocket, WebSocketServer } from "ws";
import { isLanSourceIp } from "./source-ip";
import { getOnlineHost, markHostOffline, putHost } from "./hosts";
import { isAuthedCookie, LOGIN_COOKIE, loginFromEnv, parseCookies } from "./login.mjs";

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

function parseHostPath(pathname: string): { hostId: string; rest: string } | null {
  const match = /^\/h\/([^/]+)(\/.*)?$/.exec(pathname);
  if (!match) return null;
  const rest = match[2] && match[2].length > 0 ? match[2] : "/";
  return { hostId: decodeURIComponent(match[1]), rest };
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
        waiter.client.close(msg.code || 1000, msg.reason || "");
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

function attachHostSocket(id: string, name: string, socket: TunnelSocket): void {
  putHost(id, name, socket);
  socket.on("message", (raw) => onTunnelMessage(id, socket, raw));
  socket.on("close", () => {
    const row = getOnlineHost(id);
    if (row?.socket === socket) markHostOffline(id);
  });
  socket.on("error", () => {
    const row = getOnlineHost(id);
    if (row?.socket === socket) markHostOffline(id);
  });
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

export async function proxyHostHttp(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const parsed = parseHostPath(url.pathname);
  if (!parsed) return false;

  const host = getOnlineHost(parsed.hostId);
  if (!host?.socket) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Host is not online.\n");
    return true;
  }

  const body = await readRequestBody(req);
  const requestId = randomUUID();
  const forwardUrl = `${parsed.rest}${url.search}`;
  sendJson(host.socket, {
    type: "http-request",
    id: requestId,
    method: req.method ?? "GET",
    url: forwardUrl,
    headers: filterHeaders(req.headers),
    body: body.length > 0 ? body.toString("base64") : "",
  });

  try {
    const reply = await waitForHttpResponse(host.socket, requestId);
    const headers = filterHeaders(reply.headers ?? {});
    const payload = reply.body ? Buffer.from(reply.body, "base64") : Buffer.alloc(0);
    headers["content-length"] = String(payload.length);
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

function handleClientWsUpgrade(
  wss: WebSocketServer,
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const parsed = parseHostPath(url.pathname);
  if (!parsed) {
    socket.destroy();
    return;
  }
  const host = getOnlineHost(parsed.hostId);
  if (!host?.socket) {
    rejectSocket(socket, 404, "Not Found");
    return;
  }
  const hostSocket = host.socket;

  void clientIsAuthed(req).then((authed) => {
    if (!authed) {
      rejectSocket(socket, 401, "Unauthorized");
      return;
    }
    const channelId = randomUUID();
    const forwardUrl = `${parsed.rest}${url.search}`;
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
    if (parseHostPath(pathname)) {
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
