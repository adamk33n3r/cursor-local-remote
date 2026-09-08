import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { connectHostTunnel } from "../src/lib/tunnel-client";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const relayCli = join(root, "packages", "cursor-remote-relay", "bin", "cursor-remote-relay.mjs");
const hostCli = join(root, "bin", "cursor-remote.mjs");

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
  delete env.CURSOR_REMOTE_RELAY_STATE_DIR;
  return {
    ...env,
    CURSOR_REMOTE_RELAY_STATE_DIR: mkdtempSync(join(tmpdir(), "cr-relay-state-")),
    ...overrides,
  };
}

function startBin(cli: string, args: string[], env: NodeJS.ProcessEnv): Proc {
  const child = spawn(process.execPath, [cli, ...args], {
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

function startRelay(args: string[], env: NodeJS.ProcessEnv): Proc {
  return startBin(relayCli, args, env);
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
          `process exited (code=${code} signal=${signal}) before matching ${pattern}. stdout=${proc.stdout()} stderr=${proc.stderr()}`,
        ),
      );
    });
    check();
  });
}

async function stopProc(proc: Proc): Promise<void> {
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
    if (pathname === "/api/info") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ workspace: "/stub-workspace", ok: true }));
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<html><body>stub-host-ui</body></html>");
  });
  server.on("upgrade", (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, () => undefined);
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

async function listHosts(
  relayPort: number,
  cookie: string,
): Promise<Array<{ id: string; name: string; online: boolean }>> {
  const listed = await fetch(`http://127.0.0.1:${relayPort}/api/hosts`, { headers: { cookie } });
  assert.equal(listed.status, 200);
  const body = (await listed.json()) as { hosts?: Array<{ id: string; name: string; online: boolean }> };
  assert.ok(Array.isArray(body.hosts));
  return body.hosts;
}

async function forgetHostRow(
  relayPort: number,
  cookie: string,
  hostId: string,
): Promise<Response> {
  return fetch(`http://127.0.0.1:${relayPort}/api/hosts/${encodeURIComponent(hostId)}/forget`, {
    method: "POST",
    headers: { cookie },
    redirect: "manual",
  });
}

describe("Forget, persist, drop, reconnect", { concurrency: false }, () => {
  test("last-known Hosts survive Relay restart as offline until they reconnect", async (t) => {
    const stateDir = mkdtempSync(join(tmpdir(), "cr-relay-forget-"));
    t.after(() => rmSync(stateDir, { recursive: true, force: true }));

    const relayPort = await freePort();
    const first = startRelay(
      ["--port", String(relayPort), "--host", "127.0.0.1"],
      relayEnv({
        LOGIN_USERNAME: "relay-user",
        LOGIN_PASSWORD: "correct-horse",
        CURSOR_REMOTE_RELAY_STATE_DIR: stateDir,
      }),
    );
    await waitForStdout(first, /Press Ctrl\+C to stop/, 60_000);

    const stub = await startStubHost();
    t.after(() => stub.close());
    const hostId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const tunnel = await connectHostTunnel({
      relayUrl: `http://127.0.0.1:${relayPort}`,
      localOrigin: `http://127.0.0.1:${stub.port}`,
      id: hostId,
      name: "Desk PC",
    });

    const cookie = await loginCookie(relayPort);
    assert.deepEqual(await listHosts(relayPort, cookie), [
      { id: hostId, name: "Desk PC", online: true },
    ]);
    await tunnel.close();
    assert.deepEqual(await listHosts(relayPort, cookie), [
      { id: hostId, name: "Desk PC", online: false },
    ]);

    await stopProc(first);

    const second = startRelay(
      ["--port", String(relayPort), "--host", "127.0.0.1"],
      relayEnv({
        LOGIN_USERNAME: "relay-user",
        LOGIN_PASSWORD: "correct-horse",
        CURSOR_REMOTE_RELAY_STATE_DIR: stateDir,
      }),
    );
    t.after(() => stopProc(second));
    await waitForStdout(second, /Press Ctrl\+C to stop/, 60_000);

    const cookieAgain = await loginCookie(relayPort);
    assert.deepEqual(await listHosts(relayPort, cookieAgain), [
      { id: hostId, name: "Desk PC", online: false },
    ]);
  });

  test("Forget removes the offline row and survives Relay restart", async (t) => {
    const stateDir = mkdtempSync(join(tmpdir(), "cr-relay-forget-"));
    t.after(() => rmSync(stateDir, { recursive: true, force: true }));
    const relayPort = await freePort();
    const env = relayEnv({
      LOGIN_USERNAME: "relay-user",
      LOGIN_PASSWORD: "correct-horse",
      CURSOR_REMOTE_RELAY_STATE_DIR: stateDir,
    });
    const first = startRelay(["--port", String(relayPort), "--host", "127.0.0.1"], env);
    await waitForStdout(first, /Press Ctrl\+C to stop/, 60_000);

    const stub = await startStubHost();
    t.after(() => stub.close());
    const hostId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const tunnel = await connectHostTunnel({
      relayUrl: `http://127.0.0.1:${relayPort}`,
      localOrigin: `http://127.0.0.1:${stub.port}`,
      id: hostId,
      name: "Office PC",
    });
    const cookie = await loginCookie(relayPort);
    await tunnel.close();

    const forgotten = await forgetHostRow(relayPort, cookie, hostId);
    assert.equal(forgotten.status, 204);
    assert.deepEqual(await listHosts(relayPort, cookie), []);

    await stopProc(first);
    const second = startRelay(["--port", String(relayPort), "--host", "127.0.0.1"], env);
    t.after(() => stopProc(second));
    await waitForStdout(second, /Press Ctrl\+C to stop/, 60_000);
    const cookieAgain = await loginCookie(relayPort);
    assert.deepEqual(await listHosts(relayPort, cookieAgain), []);
  });

  test("Forget is rejected while the Host is online and does not drop the Tunnel", async (t) => {
    const relayPort = await freePort();
    const proc = startRelay(
      ["--port", String(relayPort), "--host", "127.0.0.1"],
      relayEnv({ LOGIN_USERNAME: "relay-user", LOGIN_PASSWORD: "correct-horse" }),
    );
    t.after(() => stopProc(proc));
    await waitForStdout(proc, /Press Ctrl\+C to stop/, 60_000);

    const stub = await startStubHost();
    t.after(() => stub.close());
    const hostId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const tunnel = await connectHostTunnel({
      relayUrl: `http://127.0.0.1:${relayPort}`,
      localOrigin: `http://127.0.0.1:${stub.port}`,
      id: hostId,
      name: "Laptop",
    });
    t.after(() => tunnel.close());

    const cookie = await loginCookie(relayPort);
    const rejected = await forgetHostRow(relayPort, cookie, hostId);
    assert.equal(rejected.status, 409);
    assert.deepEqual(await listHosts(relayPort, cookie), [
      { id: hostId, name: "Laptop", online: true },
    ]);

    const pick = await fetch(`http://127.0.0.1:${relayPort}/h/${hostId}/`, {
      headers: { cookie },
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(pick.status, 200);
    assert.match(await pick.text(), /stub-host-ui/);
  });

  test("reconnect with the same id after Forget is a new Registration", async (t) => {
    const relayPort = await freePort();
    const proc = startRelay(
      ["--port", String(relayPort), "--host", "127.0.0.1"],
      relayEnv({ LOGIN_USERNAME: "relay-user", LOGIN_PASSWORD: "correct-horse" }),
    );
    t.after(() => stopProc(proc));
    await waitForStdout(proc, /Press Ctrl\+C to stop/, 60_000);

    const stub = await startStubHost();
    t.after(() => stub.close());
    const hostId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const tunnel = await connectHostTunnel({
      relayUrl: `http://127.0.0.1:${relayPort}`,
      localOrigin: `http://127.0.0.1:${stub.port}`,
      id: hostId,
      name: "Desk PC",
    });
    const cookie = await loginCookie(relayPort);
    await tunnel.close();
    assert.equal((await forgetHostRow(relayPort, cookie, hostId)).status, 204);
    assert.deepEqual(await listHosts(relayPort, cookie), []);

    const again = await connectHostTunnel({
      relayUrl: `http://127.0.0.1:${relayPort}`,
      localOrigin: `http://127.0.0.1:${stub.port}`,
      id: hostId,
      name: "Desk PC",
    });
    t.after(() => again.close());
    assert.deepEqual(await listHosts(relayPort, cookie), [
      { id: hostId, name: "Desk PC", online: true },
    ]);
  });

  test("Tunnel drop marks the row offline immediately; sticky Host requests error", async (t) => {
    const relayPort = await freePort();
    const proc = startRelay(
      ["--port", String(relayPort), "--host", "127.0.0.1"],
      relayEnv({ LOGIN_USERNAME: "relay-user", LOGIN_PASSWORD: "correct-horse" }),
    );
    t.after(() => stopProc(proc));
    await waitForStdout(proc, /Press Ctrl\+C to stop/, 60_000);

    const stub = await startStubHost();
    t.after(() => stub.close());
    const hostId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const tunnel = await connectHostTunnel({
      relayUrl: `http://127.0.0.1:${relayPort}`,
      localOrigin: `http://127.0.0.1:${stub.port}`,
      id: hostId,
      name: "Desk PC",
    });

    const cookie = await loginCookie(relayPort);
    const pick = await fetch(`http://127.0.0.1:${relayPort}/h/${hostId}/`, {
      headers: { cookie },
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(pick.status, 200);
    const pickSet = pick.headers.getSetCookie().find((c) => c.startsWith("cr_pick="));
    assert.ok(pickSet);
    const sticky = `${cookie}; ${pickSet.split(";")[0]}`;

    await tunnel.close();
    const started = Date.now();
    assert.deepEqual(await listHosts(relayPort, cookie), [
      { id: hostId, name: "Desk PC", online: false },
    ]);
    const stickyApi = await fetch(`http://127.0.0.1:${relayPort}/api/info`, {
      headers: { cookie: sticky },
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(stickyApi.status, 502);
    assert.ok(Date.now() - started < 2_000, "drop waited on the Tunnel instead of failing immediately");
  });

  test("Host retries Registration after Relay restart until the row is online again", async (t) => {
    const stateDir = mkdtempSync(join(tmpdir(), "cr-relay-forget-"));
    t.after(() => rmSync(stateDir, { recursive: true, force: true }));
    const relayPort = await freePort();
    const env = relayEnv({
      LOGIN_USERNAME: "relay-user",
      LOGIN_PASSWORD: "correct-horse",
      CURSOR_REMOTE_RELAY_STATE_DIR: stateDir,
    });
    const first = startRelay(["--port", String(relayPort), "--host", "127.0.0.1"], env);
    await waitForStdout(first, /Press Ctrl\+C to stop/, 60_000);

    const stub = await startStubHost();
    t.after(() => stub.close());
    const hostId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const tunnel = await connectHostTunnel({
      relayUrl: `http://127.0.0.1:${relayPort}`,
      localOrigin: `http://127.0.0.1:${stub.port}`,
      id: hostId,
      name: "Desk PC",
      reconnectMs: 100,
    });
    t.after(() => tunnel.close());

    const cookie = await loginCookie(relayPort);
    await stopProc(first);

    const second = startRelay(["--port", String(relayPort), "--host", "127.0.0.1"], env);
    t.after(() => stopProc(second));
    await waitForStdout(second, /Press Ctrl\+C to stop/, 60_000);
    const cookieAgain = await loginCookie(relayPort);

    const deadline = Date.now() + 8_000;
    let last: unknown = [];
    while (Date.now() < deadline) {
      last = await listHosts(relayPort, cookieAgain);
      if (
        Array.isArray(last) &&
        last.length === 1 &&
        last[0].id === hostId &&
        last[0].online
      ) {
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`timed out waiting for Host reconnect: ${JSON.stringify(last)}`);
  });

  test("Forget of the Host the User was in lands on the Host list", async (t) => {
    const relayPort = await freePort();
    const proc = startRelay(
      ["--port", String(relayPort), "--host", "127.0.0.1"],
      relayEnv({ LOGIN_USERNAME: "relay-user", LOGIN_PASSWORD: "correct-horse" }),
    );
    t.after(() => stopProc(proc));
    await waitForStdout(proc, /Press Ctrl\+C to stop/, 60_000);

    const stub = await startStubHost();
    t.after(() => stub.close());
    const hostId = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const tunnel = await connectHostTunnel({
      relayUrl: `http://127.0.0.1:${relayPort}`,
      localOrigin: `http://127.0.0.1:${stub.port}`,
      id: hostId,
      name: "Desk PC",
    });
    const cookie = await loginCookie(relayPort);
    const pick = await fetch(`http://127.0.0.1:${relayPort}/h/${hostId}/`, {
      headers: { cookie },
      signal: AbortSignal.timeout(10_000),
    });
    const pickSet = pick.headers.getSetCookie().find((c) => c.startsWith("cr_pick="));
    assert.ok(pickSet);
    const sticky = `${cookie}; ${pickSet.split(";")[0]}`;
    await tunnel.close();
    assert.equal((await forgetHostRow(relayPort, sticky, hostId)).status, 204);

    const after = await fetch(`http://127.0.0.1:${relayPort}/h/${hostId}/`, {
      headers: { cookie: sticky },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    assert.ok(after.status === 302 || after.status === 303);
    assert.match(after.headers.get("location") ?? "", /\/hosts$/);

    const stickyApi = await fetch(`http://127.0.0.1:${relayPort}/api/info`, {
      headers: { cookie: sticky },
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(stickyApi.status, 410);
  });

  test("Direct LAN to that Host is unchanged by Forget or Tunnel drop", async (t) => {
    const stateDir = mkdtempSync(join(tmpdir(), "cr-host-forget-lan-"));
    t.after(() => rmSync(stateDir, { recursive: true, force: true }));
    const relayPort = await freePort();
    const hostPort = await freePort();
    const relay = startRelay(
      ["--port", String(relayPort), "--host", "127.0.0.1"],
      relayEnv({ LOGIN_USERNAME: "relay-user", LOGIN_PASSWORD: "correct-horse" }),
    );
    t.after(() => stopProc(relay));
    await waitForStdout(relay, /Press Ctrl\+C to stop/, 60_000);

    const env = relayEnv({ CURSOR_REMOTE_STATE_DIR: stateDir });
    delete env.AUTH_TOKEN;
    const hostProc = startBin(
      hostCli,
      [
        "--port",
        String(hostPort),
        "--host",
        "127.0.0.1",
        "--no-open",
        "--no-qr",
        "--token",
        "lan-token",
        "--relay",
        `http://127.0.0.1:${relayPort}`,
      ],
      env,
    );
    t.after(() => stopProc(hostProc));
    await waitForStdout(hostProc, /Ready/, 60_000);

    const cookie = await loginCookie(relayPort);
    const deadline = Date.now() + 15_000;
    let appeared = false;
    while (Date.now() < deadline) {
      const hosts = await listHosts(relayPort, cookie);
      if (hosts.length === 1 && hosts[0].online) {
        appeared = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.ok(appeared, "Host never appeared on the Host list");

    const hosts = await listHosts(relayPort, cookie);
    assert.equal((await forgetHostRow(relayPort, cookie, hosts[0].id)).status, 409);

    const before = await fetch(`http://127.0.0.1:${hostPort}/`, {
      headers: { Authorization: "Bearer lan-token" },
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(before.status, 200);

    await stopProc(relay);

    const afterDrop = await fetch(`http://127.0.0.1:${hostPort}/`, {
      headers: { Authorization: "Bearer lan-token" },
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(afterDrop.status, 200);
    assert.match(await afterDrop.text(), /Cursor Remote/);
  });
});
