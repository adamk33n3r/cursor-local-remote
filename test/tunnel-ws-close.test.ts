import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createServer, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { test } from "node:test";
import { WebSocket, WebSocketServer } from "ws";
import { connectHostTunnel } from "../src/lib/tunnel-client";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createNetServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

type Inbound = { type?: string; id?: string; status?: number; body?: string };

type StubRelay = {
  port: number;
  send: (value: unknown) => void;
  waitFor: (pred: (msg: Inbound) => boolean, label: string) => Promise<Inbound>;
  close: () => Promise<void>;
};

function startStubRelay(port: number): Promise<StubRelay> {
  const wss = new WebSocketServer({ noServer: true });
  const server = createServer();
  const inbound: Inbound[] = [];
  let hostSocket: WebSocket | null = null;

  server.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname !== "/tunnel") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      hostSocket = ws;
      ws.on("message", (raw) => {
        let parsed: Inbound;
        try {
          parsed = JSON.parse(String(raw)) as Inbound;
        } catch {
          return;
        }
        inbound.push(parsed);
        if (parsed.type === "register") {
          ws.send(JSON.stringify({ type: "registered" }));
        }
      });
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      resolve({
        port,
        send: (value: unknown) => {
          if (!hostSocket || hostSocket.readyState !== WebSocket.OPEN) {
            throw new Error("Host Tunnel is not open");
          }
          hostSocket.send(JSON.stringify(value));
        },
        waitFor: (pred, label) =>
          waitForMessage(inbound, pred, label),
        close: () => closeStub(server, wss),
      });
    });
  });
}

function waitForMessage(
  inbound: Inbound[],
  pred: (msg: Inbound) => boolean,
  label: string,
  timeoutMs = 4_000,
): Promise<Inbound> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const hit = inbound.find(pred);
      if (hit) {
        resolve(hit);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`timed out waiting for ${label}`));
        return;
      }
      setTimeout(tick, 10);
    };
    tick();
  });
}

function closeStub(server: Server, wss: WebSocketServer): Promise<void> {
  return new Promise((resolve, reject) => {
    for (const client of wss.clients) client.terminate();
    wss.close();
    server.closeAllConnections();
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function startLocalHost(): Promise<{ origin: string; close: () => Promise<void> }> {
  const wss = new WebSocketServer({ noServer: true });
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname === "/hello") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("still-here");
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname !== "/live") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, () => undefined);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        origin: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((resClose, rejClose) => {
            for (const client of wss.clients) client.terminate();
            wss.close();
            server.closeAllConnections();
            server.close((err) => (err ? rejClose(err) : resClose()));
          }),
      });
    });
  });
}

test("reserved Client close code 1006 does not kill the Host Tunnel", async (t) => {
  const port = await freePort();
  const relay = await startStubRelay(port);
  t.after(() => relay.close());
  const local = await startLocalHost();
  t.after(() => local.close());

  const tunnel = await connectHostTunnel({
    relayUrl: `http://127.0.0.1:${port}`,
    localOrigin: local.origin,
    id: "55555555-5555-4555-8555-555555555555",
    name: "Desk PC",
  });
  t.after(() => tunnel.close());

  const channelId = "live-1";
  relay.send({ type: "ws-open", id: channelId, url: "/live" });
  await relay.waitFor((msg) => msg.type === "ws-opened" && msg.id === channelId, "ws-opened");

  relay.send({ type: "ws-close", id: channelId, code: 1006, reason: "" });

  const httpId = "http-after-close";
  relay.send({ type: "http-request", id: httpId, url: "/hello", method: "GET" });
  const reply = await relay.waitFor(
    (msg) => msg.type === "http-response" && msg.id === httpId,
    "http-response after reserved close",
  );
  assert.equal(reply.status, 200);
  assert.equal(Buffer.from(reply.body ?? "", "base64").toString(), "still-here");
});
