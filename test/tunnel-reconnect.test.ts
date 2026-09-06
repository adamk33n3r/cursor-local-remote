import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { test } from "node:test";
import { WebSocketServer } from "ws";
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

type StubRelay = {
  port: number;
  registerCount: () => number;
  dropClients: () => void;
  close: () => Promise<void>;
};

function startStubRelay(port: number): Promise<StubRelay> {
  const wss = new WebSocketServer({ noServer: true });
  const server = createServer();
  let registerCount = 0;

  server.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname !== "/tunnel") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on("message", (raw) => {
        let parsed: { type?: string };
        try {
          parsed = JSON.parse(String(raw)) as { type?: string };
        } catch {
          return;
        }
        if (parsed.type === "register") {
          registerCount += 1;
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
        registerCount: () => registerCount,
        dropClients: () => {
          for (const client of wss.clients) client.terminate();
        },
        close: () => closeStub(server, wss),
      });
    });
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

function waitFor(
  check: () => boolean,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (check()) {
        resolve();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`timed out waiting for ${label}`));
        return;
      }
      setTimeout(tick, 20);
    };
    tick();
  });
}

test("Host reconnects the Tunnel after the Relay drops and logs lost, retry, and success", async (t) => {
  const port = await freePort();
  let relay = await startStubRelay(port);
  t.after(async () => {
    try {
      await relay.close();
    } catch {
      // already closed between down/up
    }
  });

  const logs: string[] = [];
  const tunnel = await connectHostTunnel({
    relayUrl: `http://127.0.0.1:${port}`,
    localOrigin: "http://127.0.0.1:9",
    id: "33333333-3333-4333-8333-333333333333",
    name: "Desk PC",
    reconnectMs: 50,
    log: (message) => logs.push(message),
  });
  t.after(() => tunnel.close());
  assert.equal(relay.registerCount(), 1);

  await relay.close();

  await waitFor(
    () => logs.some((line) => /Relay connection lost/.test(line)),
    2_000,
    "lost-connection log",
  );
  await waitFor(
    () => logs.some((line) => /Retrying Relay connection/.test(line)),
    2_000,
    "retry log",
  );

  relay = await startStubRelay(port);

  await waitFor(() => relay.registerCount() >= 1, 4_000, "Host Registration after Relay returns");
  await waitFor(
    () => logs.some((line) => /Reconnected to Relay/.test(line)),
    2_000,
    "reconnect success log",
  );
});

test("Host close() stops Tunnel reconnect attempts", async (t) => {
  const port = await freePort();
  const relay = await startStubRelay(port);
  t.after(() => relay.close());

  const logs: string[] = [];
  const tunnel = await connectHostTunnel({
    relayUrl: `http://127.0.0.1:${port}`,
    localOrigin: "http://127.0.0.1:9",
    id: "44444444-4444-4444-8444-444444444444",
    name: "Laptop",
    reconnectMs: 50,
    log: (message) => logs.push(message),
  });

  relay.dropClients();
  await waitFor(
    () => logs.some((line) => /Relay connection lost/.test(line)),
    2_000,
    "lost-connection log",
  );
  await tunnel.close();

  const retriesAfterClose = logs.filter((line) => /Retrying Relay connection/.test(line)).length;
  await new Promise((resolve) => setTimeout(resolve, 250));
  const retriesLater = logs.filter((line) => /Retrying Relay connection/.test(line)).length;
  assert.equal(retriesLater, retriesAfterClose);
  assert.equal(relay.registerCount(), 1);
});
