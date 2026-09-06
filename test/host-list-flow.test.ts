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
  return { ...env, ...overrides };
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

async function waitForHostRow(
  relayPort: number,
  cookie: string,
  timeoutMs = 15_000,
): Promise<{ id: string; name: string; online: boolean }> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown = { hosts: [] };
  while (Date.now() < deadline) {
    const listed = await fetch(`http://127.0.0.1:${relayPort}/api/hosts`, {
      headers: { cookie },
    });
    if (listed.status === 200) {
      last = await listed.json();
      const hosts = (last as { hosts?: Array<{ id: string; name: string; online: boolean }> }).hosts;
      if (Array.isArray(hosts) && hosts.length === 1 && hosts[0].online) return hosts[0];
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out waiting for Host-list row: ${JSON.stringify(last)}`);
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

describe("Host list then Host", { concurrency: false }, () => {
  test("offline pick does not open the Host UI; the list still shows that row", async (t) => {
    const relayPort = await freePort();
    const proc = startRelay(
      ["--port", String(relayPort), "--host", "127.0.0.1"],
      relayEnv({ LOGIN_USERNAME: "relay-user", LOGIN_PASSWORD: "correct-horse" }),
    );
    t.after(() => stopRelay(proc));
    await waitForStdout(proc, /Press Ctrl\+C to stop/, 60_000);

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
    await tunnel.close();

    const pick = await fetch(`http://127.0.0.1:${relayPort}/h/${hostId}/`, {
      headers: { cookie },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    assert.notEqual(pick.status, 200);
    assert.doesNotMatch(await pick.text(), /stub-host-ui/);
    assert.ok(pick.status === 302 || pick.status === 303);
    assert.match(pick.headers.get("location") ?? "", /\/hosts$/);

    const listed = await fetch(`http://127.0.0.1:${relayPort}/api/hosts`, { headers: { cookie } });
    assert.equal(listed.status, 200);
    assert.deepEqual(await listed.json(), {
      hosts: [{ id: hostId, name: "Desk PC", online: false }],
    });
  });

  test("Host list live stream pushes new rows and online/offline without a new HTTP GET", async (t) => {
    const relayPort = await freePort();
    const proc = startRelay(
      ["--port", String(relayPort), "--host", "127.0.0.1"],
      relayEnv({ LOGIN_USERNAME: "relay-user", LOGIN_PASSWORD: "correct-horse" }),
    );
    t.after(() => stopRelay(proc));
    await waitForStdout(proc, /Press Ctrl\+C to stop/, 60_000);

    const cookie = await loginCookie(relayPort);
    const ws = new WebSocket(`ws://127.0.0.1:${relayPort}/api/hosts/live`, {
      headers: { cookie },
    });
    t.after(() => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.terminate();
    });

    const first = await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for live snapshot")), 8_000);
      ws.once("message", (data) => {
        clearTimeout(timer);
        resolve(JSON.parse(String(data)));
      });
      ws.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    assert.deepEqual(first, { hosts: [] });

    const stub = await startStubHost();
    t.after(() => stub.close());
    const hostId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

    const waitOnline = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for online row")), 8_000);
      ws.once("message", (data) => {
        clearTimeout(timer);
        resolve(JSON.parse(String(data)));
      });
      ws.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    const tunnel = await connectHostTunnel({
      relayUrl: `http://127.0.0.1:${relayPort}`,
      localOrigin: `http://127.0.0.1:${stub.port}`,
      id: hostId,
      name: "Office PC",
    });
    t.after(() => tunnel.close());

    const online = await waitOnline;
    assert.deepEqual(online, {
      hosts: [{ id: hostId, name: "Office PC", online: true }],
    });

    const waitOffline = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for offline row")), 8_000);
      ws.once("message", (data) => {
        clearTimeout(timer);
        resolve(JSON.parse(String(data)));
      });
      ws.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    await tunnel.close();
    const offline = await waitOffline;
    assert.deepEqual(offline, {
      hosts: [{ id: hostId, name: "Office PC", online: false }],
    });
  });

  test("logged-out Host URL: Login then that Host if online, else the list with the row offline", async (t) => {
    const relayPort = await freePort();
    const proc = startRelay(
      ["--port", String(relayPort), "--host", "127.0.0.1"],
      relayEnv({ LOGIN_USERNAME: "relay-user", LOGIN_PASSWORD: "correct-horse" }),
    );
    t.after(() => stopRelay(proc));
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

    const unauth = await fetch(`http://127.0.0.1:${relayPort}/h/${hostId}/`, {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    assert.ok(unauth.status === 302 || unauth.status === 303);
    const loginLoc = unauth.headers.get("location") ?? "";
    assert.match(loginLoc, /\/\?next=/);
    assert.match(loginLoc, new RegExp(hostId));

    const afterLoginOnline = await fetch(`http://127.0.0.1:${relayPort}/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      redirect: "manual",
      body: `username=relay-user&password=correct-horse&next=${encodeURIComponent(`/h/${hostId}/`)}`,
    });
    assert.ok(afterLoginOnline.status === 302 || afterLoginOnline.status === 303);
    assert.match(afterLoginOnline.headers.get("location") ?? "", new RegExp(`/h/${hostId}/`));
    const cookie = afterLoginOnline.headers.getSetCookie().find((c) => c.startsWith("cr_login="));
    assert.ok(cookie);

    await tunnel.close();
    const afterLoginOffline = await fetch(`http://127.0.0.1:${relayPort}/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      redirect: "manual",
      body: `username=relay-user&password=correct-horse&next=${encodeURIComponent(`/h/${hostId}/`)}`,
    });
    assert.ok(afterLoginOffline.status === 302 || afterLoginOffline.status === 303);
    assert.match(afterLoginOffline.headers.get("location") ?? "", /\/hosts$/);

    const listed = await fetch(`http://127.0.0.1:${relayPort}/api/hosts`, {
      headers: { cookie: cookie.split(";")[0] },
    });
    assert.deepEqual(await listed.json(), {
      hosts: [{ id: hostId, name: "Laptop", online: false }],
    });
  });

  test("pick is sticky while logged in and online; Hosts returns to the list without Logout", async (t) => {
    const relayPort = await freePort();
    const proc = startRelay(
      ["--port", String(relayPort), "--host", "127.0.0.1"],
      relayEnv({ LOGIN_USERNAME: "relay-user", LOGIN_PASSWORD: "correct-horse" }),
    );
    t.after(() => stopRelay(proc));
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
    t.after(() => tunnel.close());

    const cookie = await loginCookie(relayPort);
    const pick = await fetch(`http://127.0.0.1:${relayPort}/h/${hostId}/`, {
      headers: { cookie },
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(pick.status, 200);
    assert.match(await pick.text(), /stub-host-ui/);
    const pickSet = pick.headers.getSetCookie().find((c) => c.startsWith("cr_pick="));
    assert.ok(pickSet);
    const sticky = `${cookie}; ${pickSet.split(";")[0]}`;

    const refresh = await fetch(`http://127.0.0.1:${relayPort}/h/${hostId}/`, {
      headers: { cookie: sticky },
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(refresh.status, 200);
    assert.match(await refresh.text(), /stub-host-ui/);

    const apiSticky = await fetch(`http://127.0.0.1:${relayPort}/api/info`, {
      headers: { cookie: sticky },
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(apiSticky.status, 200);
    assert.deepEqual(await apiSticky.json(), { workspace: "/stub-workspace", ok: true });

    const listRes = await fetch(`http://127.0.0.1:${relayPort}/hosts`, {
      headers: { cookie: sticky },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(listRes.status, 200);
    const listHtml = await listRes.text();
    assert.match(listHtml, /Hosts/);
    assert.doesNotMatch(listHtml, /stub-host-ui/);
    const cleared = listRes.headers.getSetCookie().find((c) => c.startsWith("cr_pick="));
    assert.ok(cleared);
    assert.match(cleared, /Max-Age=0/i);

    const stillLoggedIn = await fetch(`http://127.0.0.1:${relayPort}/api/hosts`, {
      headers: { cookie: sticky },
    });
    assert.equal(stillLoggedIn.status, 200);
  });

  test("Logout leaves the Host list and the sticky Host path", async (t) => {
    const relayPort = await freePort();
    const proc = startRelay(
      ["--port", String(relayPort), "--host", "127.0.0.1"],
      relayEnv({ LOGIN_USERNAME: "relay-user", LOGIN_PASSWORD: "correct-horse" }),
    );
    t.after(() => stopRelay(proc));
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
    t.after(() => tunnel.close());

    const cookie = await loginCookie(relayPort);
    const pick = await fetch(`http://127.0.0.1:${relayPort}/h/${hostId}/`, {
      headers: { cookie },
      signal: AbortSignal.timeout(10_000),
    });
    const pickSet = pick.headers.getSetCookie().find((c) => c.startsWith("cr_pick="));
    assert.ok(pickSet);
    const sticky = `${cookie}; ${pickSet.split(";")[0]}`;

    const logout = await fetch(`http://127.0.0.1:${relayPort}/logout`, {
      method: "POST",
      headers: { cookie: sticky },
      redirect: "manual",
    });
    assert.ok(logout.status === 302 || logout.status === 303);
    assert.match(logout.headers.get("location") ?? "", /\/$/);

    const after = await fetch(`http://127.0.0.1:${relayPort}/h/${hostId}/`, {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    assert.ok(after.status === 302 || after.status === 303);
    assert.match(after.headers.get("location") ?? "", /\/\?next=/);

    const hosts = await fetch(`http://127.0.0.1:${relayPort}/api/hosts`);
    assert.equal(hosts.status, 401);
  });

  test("duplicate display names are separate Host-list rows", async (t) => {
    const relayPort = await freePort();
    const proc = startRelay(
      ["--port", String(relayPort), "--host", "127.0.0.1"],
      relayEnv({ LOGIN_USERNAME: "relay-user", LOGIN_PASSWORD: "correct-horse" }),
    );
    t.after(() => stopRelay(proc));
    await waitForStdout(proc, /Press Ctrl\+C to stop/, 60_000);

    const stubA = await startStubHost();
    const stubB = await startStubHost();
    t.after(() => stubA.close());
    t.after(() => stubB.close());
    const idA = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const idB = "22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const tunnelA = await connectHostTunnel({
      relayUrl: `http://127.0.0.1:${relayPort}`,
      localOrigin: `http://127.0.0.1:${stubA.port}`,
      id: idA,
      name: "Office PC",
    });
    const tunnelB = await connectHostTunnel({
      relayUrl: `http://127.0.0.1:${relayPort}`,
      localOrigin: `http://127.0.0.1:${stubB.port}`,
      id: idB,
      name: "Office PC",
    });
    t.after(() => tunnelA.close());
    t.after(() => tunnelB.close());

    const cookie = await loginCookie(relayPort);
    const listed = await fetch(`http://127.0.0.1:${relayPort}/api/hosts`, { headers: { cookie } });
    assert.equal(listed.status, 200);
    assert.deepEqual(await listed.json(), {
      hosts: [
        { id: idA, name: "Office PC", online: true },
        { id: idB, name: "Office PC", online: true },
      ],
    });
  });

  test("Relay Host UI has Hosts and Logout and no Token; Direct LAN has neither", async (t) => {
    const stateDir = mkdtempSync(join(tmpdir(), "cr-host-list-"));
    t.after(() => rmSync(stateDir, { recursive: true, force: true }));

    const relayPort = await freePort();
    const hostPort = await freePort();
    const relay = startRelay(
      ["--port", String(relayPort), "--host", "127.0.0.1"],
      relayEnv({ LOGIN_USERNAME: "relay-user", LOGIN_PASSWORD: "correct-horse" }),
    );
    t.after(() => stopRelay(relay));
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
    t.after(() => stopRelay(hostProc));
    await waitForStdout(hostProc, /Ready/, 60_000);

    const cookie = await loginCookie(relayPort);
    const row = await waitForHostRow(relayPort, cookie);

    const proxied = await fetch(`http://127.0.0.1:${relayPort}/h/${row.id}/`, {
      headers: { cookie },
      signal: AbortSignal.timeout(20_000),
    });
    assert.equal(proxied.status, 200);
    assert.equal(proxied.headers.get("x-host-token"), null);
    const relayHtml = await proxied.text();
    assert.doesNotMatch(relayHtml, /Paste the token/);
    assert.match(relayHtml, /href="\/hosts"/);
    assert.match(relayHtml, /action="\/logout"/);

    const lan = await fetch(`http://127.0.0.1:${hostPort}/`, {
      headers: { Authorization: "Bearer lan-token" },
      signal: AbortSignal.timeout(20_000),
    });
    assert.equal(lan.status, 200);
    const lanHtml = await lan.text();
    assert.doesNotMatch(lanHtml, /href="\/hosts"/);
    assert.doesNotMatch(lanHtml, /action="\/logout"/);
  });
});
