import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { attachLiveWebSockets, handleLiveHttpRequest } from "../src/lib/live-ws";
import { promoteToSessionId, registerProcess } from "../src/lib/process-registry";
import { killTerminal, removeTerminal, spawnTerminal } from "../src/lib/terminal-registry";

delete process.env.AUTH_TOKEN;

function listen(): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    if (!handleLiveHttpRequest(req, res)) {
      res.writeHead(404);
      res.end();
    }
  });
  attachLiveWebSockets(server);
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({ server, port: addr.port });
    });
    server.on("error", reject);
  });
}

function waitForJson(ws: WebSocket): Promise<{ event: string; data: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for WebSocket message")), 8_000);
    ws.once("message", (raw) => {
      clearTimeout(timer);
      resolve(JSON.parse(String(raw)) as { event: string; data: Record<string, unknown> });
    });
    ws.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function waitForListUpdate(
  ws: WebSocket,
  pred: (terminals: { id: string }[]) => boolean,
): Promise<{ event: string; data: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for terminal list update")), 8_000);
    const onMessage = (raw: Buffer | ArrayBuffer | Buffer[]) => {
      const msg = JSON.parse(String(raw)) as { event: string; data: Record<string, unknown> };
      if (msg.event !== "update") return;
      const terminals = msg.data.terminals as { id: string }[];
      if (!Array.isArray(terminals) || !pred(terminals)) return;
      clearTimeout(timer);
      ws.off("message", onMessage);
      resolve(msg);
    };
    ws.on("message", onMessage);
    ws.once("error", (err) => {
      clearTimeout(timer);
      ws.off("message", onMessage);
      reject(err);
    });
  });
}

async function closeWs(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.CLOSED) return;
  if (ws.readyState === WebSocket.CONNECTING) {
    ws.terminate();
    return;
  }
  await new Promise<void>((resolve) => {
    ws.once("close", () => resolve());
    if (ws.readyState !== WebSocket.CLOSING) ws.close();
  });
}

test("Client can connect a watch WebSocket and observe traffic", async (t) => {
  const { server, port } = await listen();
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
  const sockets: WebSocket[] = [];

  t.after(async () => {
    await Promise.all(sockets.map((ws) => closeWs(ws)));
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }
      child.once("exit", () => resolve());
    });
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
      server.closeAllConnections();
    });
  });

  const requestId = "req-watch-test";
  const sessionId = "session-watch-test";
  registerProcess(requestId, child, process.cwd());
  promoteToSessionId(requestId, sessionId);

  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/sessions/watch?id=${sessionId}`);
  sockets.push(ws);

  const msg = await waitForJson(ws);
  assert.equal(msg.event, "connected");
  assert.equal(msg.data.isActive, true);
  assert.ok(Array.isArray(msg.data.messages));
});

test("Client can connect a terminal WebSocket and observe traffic both ways", async (t) => {
  const { server, port } = await listen();
  const term = spawnTerminal(process.cwd());
  const sockets: WebSocket[] = [];

  t.after(async () => {
    await Promise.all(sockets.map((ws) => closeWs(ws)));
    killTerminal(term.id);
    removeTerminal(term.id);
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
      server.closeAllConnections();
    });
  });

  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/terminal/stream?id=${term.id}`);
  sockets.push(ws);

  const connected = await waitForJson(ws);
  assert.equal(connected.event, "connected");
  assert.equal(typeof connected.data.output, "string");

  const marker = `clr-ws-${Date.now()}`;
  const outputChunks: string[] = [];
  const sawMarker = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for terminal echo")), 8_000);
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw)) as { event: string; data: Record<string, unknown> };
      if (msg.event !== "output") return;
      outputChunks.push(String(msg.data.data ?? ""));
      if (outputChunks.join("").includes(marker)) {
        clearTimeout(timer);
        resolve();
      }
    });
  });

  ws.send(JSON.stringify({ type: "input", data: `echo ${marker}\n` }));
  await sawMarker;
});

test("Client can watch the terminal roster over WebSocket", async (t) => {
  const { server, port } = await listen();
  const term = spawnTerminal(process.cwd());
  const sockets: WebSocket[] = [];

  t.after(async () => {
    await Promise.all(sockets.map((ws) => closeWs(ws)));
    killTerminal(term.id);
    removeTerminal(term.id);
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
      server.closeAllConnections();
    });
  });

  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/terminal/list`);
  sockets.push(ws);

  const connected = await waitForJson(ws);
  assert.equal(connected.event, "connected");
  const initial = connected.data.terminals as { id: string }[];
  assert.ok(Array.isArray(initial));
  assert.ok(initial.some((item) => item.id === term.id));
  const knownIds = new Set(initial.map((item) => item.id));

  const spawnedP = waitForListUpdate(ws, (terminals) => terminals.some((item) => !knownIds.has(item.id)));
  const extra = spawnTerminal(process.cwd());
  t.after(() => {
    killTerminal(extra.id);
    removeTerminal(extra.id);
  });
  const spawned = await spawnedP;
  assert.equal(spawned.event, "update");

  const removedP = waitForListUpdate(ws, (terminals) => terminals.every((item) => item.id !== extra.id));
  removeTerminal(extra.id);
  const removed = await removedP;
  assert.equal(removed.event, "update");
});

test("terminal WebSocket does not wait on a stuck HMR upgrade", async (t) => {
  const hanging: Duplex[] = [];
  const server = createServer((req, res) => {
    if (!handleLiveHttpRequest(req, res)) {
      res.writeHead(404);
      res.end();
    }
  });
  attachLiveWebSockets(server, (_req, socket) => {
    hanging.push(socket);
  });
  const term = spawnTerminal(process.cwd());
  const sockets: WebSocket[] = [];

  t.after(async () => {
    for (const socket of hanging) socket.destroy();
    for (const ws of sockets) ws.terminate();
    killTerminal(term.id);
    removeTerminal(term.id);
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
      server.closeAllConnections();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });
  const port = (server.address() as AddressInfo).port;

  const hmr = new WebSocket(`ws://127.0.0.1:${port}/_next/webpack-hmr`);
  hmr.on("error", () => {});
  sockets.push(hmr);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(hmr.readyState, WebSocket.CONNECTING);

  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/terminal/stream?id=${term.id}`);
  sockets.push(ws);
  const connected = await waitForJson(ws);
  assert.equal(connected.event, "connected");
  assert.equal(hmr.readyState, WebSocket.CONNECTING);
});

test("SSE endpoints are not the live path for session watch or terminal", async (t) => {
  const { server, port } = await listen();
  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
      server.closeAllConnections();
    });
  });

  for (const path of ["/api/sessions/watch?id=session-watch-test", "/api/terminal/stream?id=term1", "/api/terminal/list"]) {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      headers: { Accept: "text/event-stream" },
    });
    const contentType = res.headers.get("content-type") ?? "";
    assert.notEqual(res.status, 200);
    assert.equal(contentType.includes("text/event-stream"), false);
    assert.equal(res.status, 426);
  }

  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  assert.equal(existsSync(join(root, "src/app/api/sessions/watch/route.ts")), false);
  assert.equal(existsSync(join(root, "src/app/api/terminal/stream/route.ts")), false);
  assert.equal(existsSync(join(root, "src/app/api/terminal/list/route.ts")), false);
});

test("Token auth gates live WebSockets", async (t) => {
  process.env.AUTH_TOKEN = "test-token";
  t.after(() => {
    delete process.env.AUTH_TOKEN;
  });

  const { server, port } = await listen();
  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
      server.closeAllConnections();
    });
  });

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/sessions/watch?id=session-watch-test`);
    ws.once("unexpected-response", (_req, res) => {
      assert.equal(res.statusCode, 401);
      res.resume();
      resolve();
    });
    ws.once("open", () => reject(new Error("unauthenticated Client opened a watch WebSocket")));
    ws.once("error", () => {
      // ws also emits error after unexpected-response
    });
  });

  const authorized = new WebSocket(`ws://127.0.0.1:${port}/api/sessions/watch?id=session-watch-test`, {
    headers: { Authorization: "Bearer test-token" },
  });
  t.after(() => {
    authorized.terminate();
  });
  await new Promise<void>((resolve, reject) => {
    authorized.once("open", () => resolve());
    authorized.once("unexpected-response", (_req, res) => {
      reject(new Error(`authorized Client was rejected with ${res.statusCode}`));
    });
    authorized.once("error", reject);
  });
});
