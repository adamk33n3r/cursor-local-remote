import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { connectHostTunnel } from "../src/lib/tunnel-client";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const relayCli = join(root, "packages", "cursor-remote-relay", "bin", "cursor-remote-relay.mjs");

type Proc = {
  child: ChildProcess;
  stdout: () => string;
  stderr: () => string;
};

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

function relayEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.LOGIN_USERNAME;
  delete env.LOGIN_PASSWORD;
  delete env.PORT;
  delete env.HOST;
  return { ...env, ...overrides };
}

function startRelay(args: string[], env: NodeJS.ProcessEnv): Proc {
  const child = spawn(process.execPath, [relayCli, ...args], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  return {
    child,
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

function waitForStdout(proc: Proc, pattern: RegExp, timeoutMs = 8_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `timed out waiting for ${pattern}. stdout=${proc.stdout()} stderr=${proc.stderr()}`,
        ),
      );
    }, timeoutMs);
    const check = () => {
      if (pattern.test(proc.stdout())) {
        clearTimeout(timer);
        proc.child.stdout?.off("data", check);
        resolve(proc.stdout());
      }
    };
    proc.child.stdout?.on("data", check);
    proc.child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Relay exited (code=${code} signal=${signal}) before matching ${pattern}. stdout=${proc.stdout()} stderr=${proc.stderr()}`,
        ),
      );
    });
    check();
  });
}

async function stopRelay(proc: Proc): Promise<void> {
  const { child } = proc;
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

async function loginCookie(relayPort: number): Promise<string> {
  const loginRes = await fetch(`http://127.0.0.1:${relayPort}/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    redirect: "manual",
    body: "username=relay-user&password=correct-horse",
  });
  assert.ok(loginRes.status === 302 || loginRes.status === 303);
  const cookies = loginRes.headers.getSetCookie();
  const cookie = cookies.find((c) => c.startsWith("cr_login="));
  assert.ok(cookie, `expected cr_login Set-Cookie, got ${JSON.stringify(cookies)}`);
  return cookie.split(";")[0];
}

function startStubHost(): Promise<{ port: number; close: () => Promise<void> }> {
  const wss = new WebSocketServer({ noServer: true });
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname === "/hello") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("hello-from-host");
      return;
    }
    if (pathname === "/api/info") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ workspace: "/stub-workspace", ok: true }));
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<html><body>stub-host-ui</body></html>");
  });
  server.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname !== "/echo") {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on("message", (data) => {
        ws.send(data);
      });
    });
  });
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        port,
        close: () =>
          new Promise<void>((resClose, rejClose) => {
            for (const client of wss.clients) client.terminate();
            wss.close();
            server.closeAllConnections();
            server.close((err) => (err ? rejClose(err) : resClose()));
          }),
      });
    });
    server.once("error", reject);
  });
}

describe("Relay Registration and Tunnel", { concurrency: false }, () => {
test("LAN Registration appears on the Host list; reconnect with the same id is the same row", async (t) => {
  const relayPort = await freePort();
  const proc = startRelay(
    ["--port", String(relayPort), "--host", "127.0.0.1"],
    relayEnv({ LOGIN_USERNAME: "relay-user", LOGIN_PASSWORD: "correct-horse" }),
  );
  t.after(() => stopRelay(proc));
  await waitForStdout(proc, /Press Ctrl\+C to stop/, 60_000);

  const stub = await startStubHost();
  t.after(() => stub.close());

  const hostId = "11111111-1111-4111-8111-111111111111";
  const tunnel = await connectHostTunnel({
    relayUrl: `http://127.0.0.1:${relayPort}`,
    localOrigin: `http://127.0.0.1:${stub.port}`,
    id: hostId,
    name: "Desk PC",
  });
  t.after(() => tunnel.close());

  const cookie = await loginCookie(relayPort);
  const headers = { cookie };

  const listed = await fetch(`http://127.0.0.1:${relayPort}/api/hosts`, { headers });
  assert.equal(listed.status, 200);
  assert.deepEqual(await listed.json(), {
    hosts: [{ id: hostId, name: "Desk PC", online: true }],
  });

  const listHtml = await (await fetch(`http://127.0.0.1:${relayPort}/hosts`, { headers })).text();
  assert.match(listHtml, /data-host-row/);
  assert.match(listHtml, new RegExp(`data-host-id="${hostId}"`));
  assert.match(listHtml, /Desk PC/);

  await tunnel.close();
  const tunnel2 = await connectHostTunnel({
    relayUrl: `http://127.0.0.1:${relayPort}`,
    localOrigin: `http://127.0.0.1:${stub.port}`,
    id: hostId,
    name: "Desk PC",
  });
  t.after(() => tunnel2.close());

  const listedAgain = await fetch(`http://127.0.0.1:${relayPort}/api/hosts`, { headers });
  assert.equal(listedAgain.status, 200);
  assert.deepEqual(await listedAgain.json(), {
    hosts: [{ id: hostId, name: "Desk PC", online: true }],
  });
});

test("after Login and pick, Relay proxies Host HTTP and one WebSocket without a Token", async (t) => {
  const relayPort = await freePort();
  const proc = startRelay(
    ["--port", String(relayPort), "--host", "127.0.0.1"],
    relayEnv({ LOGIN_USERNAME: "relay-user", LOGIN_PASSWORD: "correct-horse" }),
  );
  t.after(() => stopRelay(proc));
  await waitForStdout(proc, /Press Ctrl\+C to stop/, 60_000);

  const stub = await startStubHost();
  t.after(() => stub.close());

  const hostId = "22222222-2222-4222-8222-222222222222";
  const tunnel = await connectHostTunnel({
    relayUrl: `http://127.0.0.1:${relayPort}`,
    localOrigin: `http://127.0.0.1:${stub.port}`,
    id: hostId,
    name: "Laptop",
  });
  t.after(() => tunnel.close());

  const cookie = await loginCookie(relayPort);
  const headers = { cookie };

  const ui = await fetch(`http://127.0.0.1:${relayPort}/h/${hostId}/`, {
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(ui.status, 200);
  assert.match(await ui.text(), /stub-host-ui/);
  assert.equal(ui.headers.get("x-host-token"), null);

  const api = await fetch(`http://127.0.0.1:${relayPort}/h/${hostId}/api/info`, {
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(api.status, 200);
  assert.deepEqual(await api.json(), { workspace: "/stub-workspace", ok: true });

  const unauthPick = await fetch(`http://127.0.0.1:${relayPort}/h/${hostId}/hello`, {
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(unauthPick.status, 401);

  const hello = await fetch(`http://127.0.0.1:${relayPort}/h/${hostId}/hello`, {
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(hello.status, 200);
  assert.equal(await hello.text(), "hello-from-host");

  const ws = new WebSocket(`ws://127.0.0.1:${relayPort}/h/${hostId}/echo`, {
    headers: { cookie },
  });
  t.after(() => {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.terminate();
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out opening proxied WebSocket")), 8_000);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
  const echoed = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for echo")), 8_000);
    ws.once("message", (data) => {
      clearTimeout(timer);
      resolve(String(data));
    });
    ws.send("ping-over-tunnel");
  });
  assert.equal(echoed, "ping-over-tunnel");
});
});
