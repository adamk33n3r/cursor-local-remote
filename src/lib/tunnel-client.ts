import { Buffer } from "node:buffer";
import http from "node:http";
import type { IncomingHttpHeaders, OutgoingHttpHeaders } from "node:http";
import { WebSocket } from "ws";

export type HostTunnel = {
  close: () => Promise<void>;
};

export type ConnectHostTunnelOpts = {
  relayUrl: string;
  localOrigin: string;
  id: string;
  name: string;
  authToken?: string;
};

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
  const ws = new WebSocket(toWsUrl(relayUrl));
  const localSockets = new Map<string, WebSocket>();

  function closeLocal(channelId: string, code: number, reason: string): void {
    const local = localSockets.get(channelId);
    if (!local) return;
    localSockets.delete(channelId);
    if (local.readyState === WebSocket.OPEN) local.close(code || 1000, reason || "");
  }

  function handleMessage(raw: WebSocket.RawData): void {
    const msg = asInbound(raw);
    if (!msg) return;

    switch (msg.type) {
      case "http-request": {
        void localHttp(localOrigin, msg, authToken)
          .then((reply) => sendJson(ws, reply))
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            sendJson(ws, {
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
          sendJson(ws, { type: "ws-opened", id: msg.id });
        });
        local.on("message", (data, isBinary) => {
          const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
          sendJson(ws, {
            type: "ws-data",
            id: msg.id,
            data: buf.toString("base64"),
            binary: Boolean(isBinary),
          });
        });
        local.on("close", (code, reason) => {
          localSockets.delete(msg.id);
          sendJson(ws, {
            type: "ws-close",
            id: msg.id,
            code,
            reason: String(reason ?? ""),
          });
        });
        local.on("error", () => {
          sendJson(ws, { type: "ws-close", id: msg.id, code: 1011, reason: "local WebSocket error" });
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

  const ready = new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("timed out registering with Relay"));
    }, 8_000);
    ws.once("open", () => {
      sendJson(ws, { type: "register", id, name });
    });
    ws.on("message", (raw) => {
      const msg = asInbound(raw);
      if (msg && msg.type === "registered") {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve();
        }
        return;
      }
      handleMessage(raw);
    });
    ws.once("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    ws.once("close", (code, reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Tunnel closed before registration (code=${code} reason=${String(reason)})`));
    });
  });

  return ready.then(() => ({
    close: () =>
      new Promise<void>((resolve) => {
        const finish = (): void => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          ws.terminate();
          finish();
        }, 2_000);
        for (const channelId of [...localSockets.keys()]) closeLocal(channelId, 1000, "");
        if (ws.readyState === WebSocket.CLOSED) {
          finish();
          return;
        }
        ws.once("close", () => finish());
        ws.close();
      }),
  }));
}
