import { Buffer } from "node:buffer";
import http from "node:http";
import type { IncomingHttpHeaders, OutgoingHttpHeaders } from "node:http";
import { WebSocket } from "ws";
import { VIA_RELAY_HEADER, VIA_RELAY_VALUE } from "./via-relay.js";

export type HostTunnel = {
  close: () => Promise<void>;
};

export type ConnectHostTunnelOpts = {
  relayUrl: string;
  localOrigin: string;
  id: string;
  name: string;
  authToken?: string;
  reconnectMs?: number;
  log?: (message: string) => void;
};

// Keep retrying after the Relay process dies. Start at 3s and double up to
// 30s so a down listener is not hammered and a brief outage still comes back.
const DEFAULT_RECONNECT_MS = 3_000;
const MAX_RECONNECT_MS = 30_000;

type TunnelHttpRequest = {
  type: "http-request";
  id: string;
  url: string;
  method?: string;
  headers?: IncomingHttpHeaders;
  body?: string;
};

type TunnelHttpResponse = {
  type: "http-response";
  id: string;
  status: number;
  headers: OutgoingHttpHeaders;
  body: string;
};

type TunnelInbound =
  | TunnelHttpRequest
  | { type: "ws-open"; id: string; url: string; headers?: IncomingHttpHeaders }
  | { type: "ws-data"; id: string; data?: string; binary?: boolean }
  | { type: "ws-close"; id: string; code?: number; reason?: string }
  | { type: "registered" };

function toWsUrl(relayUrl: string): string {
  const url = new URL("/tunnel", relayUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function sendJson(ws: WebSocket, value: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(value));
  }
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

function filterHopByHop(headers: IncomingHttpHeaders | OutgoingHttpHeaders): OutgoingHttpHeaders {
  const skip = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "host",
    "content-length",
  ]);
  const out: OutgoingHttpHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (skip.has(key.toLowerCase())) continue;
    out[key] = value;
  }
  return out;
}

function localHttp(
  localOrigin: string,
  msg: TunnelHttpRequest,
  authToken: string | undefined,
): Promise<TunnelHttpResponse> {
  const target = new URL(msg.url, localOrigin);
  const headers = filterHopByHop(msg.headers ?? {});
  headers[VIA_RELAY_HEADER] = VIA_RELAY_VALUE;
  if (authToken) headers.authorization = `Bearer ${authToken}`;
  const body = msg.body ? Buffer.from(msg.body, "base64") : null;
  return new Promise((resolve, reject) => {
    const req = http.request(target, { method: msg.method || "GET", headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          type: "http-response",
          id: msg.id,
          status: res.statusCode ?? 502,
          headers: filterHopByHop(res.headers),
          body: Buffer.concat(chunks).toString("base64"),
        });
      });
    });
    req.on("error", reject);
    if (body && body.length > 0) req.write(body);
    req.end();
  });
}

function asInbound(raw: WebSocket.RawData): TunnelInbound | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || !("type" in parsed)) return null;
  const type = (parsed as { type: unknown }).type;
  switch (type) {
    case "http-request":
    case "ws-open":
    case "ws-data":
    case "ws-close":
    case "registered":
      return parsed as TunnelInbound;
    default:
      return null;
  }
}

export function connectHostTunnel(opts: ConnectHostTunnelOpts): Promise<HostTunnel> {
  const { relayUrl, localOrigin, id, name, authToken } = opts;
  const reconnectMs = opts.reconnectMs ?? DEFAULT_RECONNECT_MS;
  const log = opts.log ?? ((message: string) => console.log(message));
  const localSockets = new Map<string, WebSocket>();

  let stopped = false;
  let everRegistered = false;
  let outageAnnounced = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectDelayMs = reconnectMs;
  let ws: WebSocket | null = null;
  let readySettled = false;
  let resolveReady: (handle: HostTunnel) => void = () => undefined;
  let rejectReady: (err: Error) => void = () => undefined;

  function closeLocal(channelId: string, code: number, reason: string): void {
    const local = localSockets.get(channelId);
    if (!local) return;
    localSockets.delete(channelId);
    closeSocket(local, code, reason);
  }

  function closeAllLocals(): void {
    for (const channelId of [...localSockets.keys()]) closeLocal(channelId, 1000, "");
  }

  function handleMessage(socket: WebSocket, raw: WebSocket.RawData): void {
    const msg = asInbound(raw);
    if (!msg) return;

    switch (msg.type) {
      case "http-request": {
        void localHttp(localOrigin, msg, authToken)
          .then((reply) => sendJson(socket, reply))
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            sendJson(socket, {
              type: "http-response",
              id: msg.id,
              status: 502,
              headers: { "content-type": "text/plain" },
              body: Buffer.from(message).toString("base64"),
            });
          });
        return;
      }
      case "ws-open": {
        const target = new URL(msg.url, localOrigin);
        target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
        const headers = filterHopByHop(msg.headers ?? {});
        if (authToken) headers.authorization = `Bearer ${authToken}`;
        const local = new WebSocket(target.toString(), { headers: headers as IncomingHttpHeaders });
        localSockets.set(msg.id, local);
        local.once("open", () => {
          sendJson(socket, { type: "ws-opened", id: msg.id });
        });
        local.on("message", (data, isBinary) => {
          const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
          sendJson(socket, {
            type: "ws-data",
            id: msg.id,
            data: buf.toString("base64"),
            binary: Boolean(isBinary),
          });
        });
        local.on("close", (code, reason) => {
          localSockets.delete(msg.id);
          sendJson(socket, {
            type: "ws-close",
            id: msg.id,
            code,
            reason: String(reason ?? ""),
          });
        });
        local.on("error", () => {
          sendJson(socket, { type: "ws-close", id: msg.id, code: 1011, reason: "local WebSocket error" });
        });
        return;
      }
      case "ws-data": {
        const local = localSockets.get(msg.id);
        if (local && local.readyState === WebSocket.OPEN) {
          const data = Buffer.from(msg.data ?? "", "base64");
          local.send(data, { binary: Boolean(msg.binary) });
        }
        return;
      }
      case "ws-close": {
        closeLocal(msg.id, msg.code ?? 1000, msg.reason ?? "");
        return;
      }
      case "registered":
        return;
      default: {
        const _exhaustive: never = msg;
        return _exhaustive;
      }
    }
  }

  function clearReconnectTimer(): void {
    if (!reconnectTimer) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function announceOutage(): void {
    if (!outageAnnounced) {
      outageAnnounced = true;
      log(everRegistered ? "  Relay connection lost" : "  Relay connection failed");
    }
    log("  Retrying Relay connection...");
  }

  function scheduleReconnect(): void {
    if (stopped || reconnectTimer) return;
    announceOutage();
    const waitMs = reconnectDelayMs;
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_MS);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (stopped) return;
      openSocket();
    }, waitMs);
  }

  function openSocket(): void {
    if (stopped) return;
    const socket = new WebSocket(toWsUrl(relayUrl));
    ws = socket;
    let attemptDone = false;

    const registerTimer = setTimeout(() => {
      if (attemptDone || stopped) return;
      socket.terminate();
    }, 8_000);

    socket.once("open", () => {
      sendJson(socket, { type: "register", id, name });
    });
    socket.on("message", (raw) => {
      const msg = asInbound(raw);
      if (msg && msg.type === "registered") {
        if (!attemptDone) {
          attemptDone = true;
          clearTimeout(registerTimer);
          const wasReconnect = everRegistered;
          everRegistered = true;
          if (wasReconnect) log("  Reconnected to Relay");
          outageAnnounced = false;
          reconnectDelayMs = reconnectMs;
          if (!readySettled) {
            readySettled = true;
            resolveReady(handle);
          }
        }
        return;
      }
      handleMessage(socket, raw);
    });
    socket.on("error", () => {
      // close follows; swallowing avoids an unhandled 'error' crash
    });
    socket.once("close", () => {
      clearTimeout(registerTimer);
      if (ws === socket) ws = null;
      closeAllLocals();
      if (stopped) return;
      attemptDone = true;
      scheduleReconnect();
    });
  }

  const handle: HostTunnel = {
    close: () =>
      new Promise<void>((resolve) => {
        stopped = true;
        clearReconnectTimer();
        closeAllLocals();
        if (!readySettled) {
          readySettled = true;
          rejectReady(new Error("Tunnel closed before Registration"));
        }
        const current = ws;
        if (!current || current.readyState === WebSocket.CLOSED) {
          resolve();
          return;
        }
        const finish = (): void => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          current.terminate();
          finish();
        }, 2_000);
        current.once("close", () => finish());
        current.close();
      }),
  };

  const ready = new Promise<HostTunnel>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  openSocket();
  return ready;
}
