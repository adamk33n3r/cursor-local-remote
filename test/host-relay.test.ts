import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { hostname as osHostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const hostCli = join(root, "bin", "cursor-remote.mjs");
const relayCli = join(root, "packages", "cursor-remote-relay", "bin", "cursor-remote-relay.mjs");

type Proc = {
  child: ChildProcess;
  stdout: () => string;
  stderr: () => string;
};

type HostListBody = {
  hosts: Array<{ id: string; name: string; online: boolean }>;
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

function collectProc(child: ChildProcess): Proc {
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
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

function cleanEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.LOGIN_USERNAME;
  delete env.LOGIN_PASSWORD;
  delete env.LOGIN_MODE;
  delete env.PORT;
  delete env.HOST;
  delete env.AUTH_TOKEN;
  delete env.RELAY_URL;
  delete env.CURSOR_REMOTE_RELAY_STATE_DIR;
  return {
    ...env,
    CURSOR_REMOTE_RELAY_STATE_DIR: mkdtempSync(join(tmpdir(), "cr-relay-state-")),
    ...overrides,
  };
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
): Promise<HostListBody> {
  const deadline = Date.now() + timeoutMs;
  let lastBody: HostListBody = { hosts: [] };
  while (Date.now() < deadline) {
    const listed = await fetch(`http://127.0.0.1:${relayPort}/api/hosts`, {
      headers: { cookie },
    });
    if (listed.status === 200) {
      lastBody = (await listed.json()) as HostListBody;
      if (Array.isArray(lastBody.hosts) && lastBody.hosts.length === 1 && lastBody.hosts[0].online) {
        return lastBody;
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out waiting for Host-list row: ${JSON.stringify(lastBody)}`);
}

describe("Host Relay configuration", { concurrency: false }, () => {
test("Host CLI help documents --relay and --name", () => {
  const result = spawnSync(process.execPath, [hostCli, "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--relay/);
  assert.match(result.stdout, /--name/);
});

test("omit Relay address: Host binds for direct LAN with Token and does not register", async (t) => {
  const stateDir = mkdtempSync(join(tmpdir(), "cr-host-"));
  t.after(() => rmSync(stateDir, { recursive: true, force: true }));

  const relayPort = await freePort();
  const hostPort = await freePort();
  const relay = collectProc(
    spawn(process.execPath, [relayCli, "--dev", "--port", String(relayPort), "--host", "127.0.0.1"], {
      cwd: root,
      env: cleanEnv({ LOGIN_USERNAME: "relay-user", LOGIN_PASSWORD: "correct-horse" }),
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  t.after(() => stopProc(relay));
  await waitForStdout(relay, /Press Ctrl\+C to stop/, 60_000);

  const host = collectProc(
    spawn(
      process.execPath,
      [hostCli, "--dev", "--port", String(hostPort), "--host", "127.0.0.1", "--no-open", "--no-qr", "--token", "lan-token"],
      {
        cwd: root,
        env: cleanEnv({ CURSOR_REMOTE_STATE_DIR: stateDir }),
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
  );
  t.after(() => stopProc(host));
  const hostOut = await waitForStdout(host, /Ready/, 60_000);
  assert.match(hostOut, /Auth token:/);
  assert.match(hostOut, /lan-token/);

  const denied = await fetch(`http://127.0.0.1:${hostPort}/api/info`);
  assert.equal(denied.status, 401);

  const allowed = await fetch(`http://127.0.0.1:${hostPort}/api/info`, {
    headers: { Authorization: "Bearer lan-token" },
  });
  assert.equal(allowed.status, 200);

  const cookie = await loginCookie(relayPort);
  const hosts = await fetch(`http://127.0.0.1:${relayPort}/api/hosts`, {
    headers: { cookie },
  });
  assert.equal(hosts.status, 200);
  assert.deepEqual(await hosts.json(), { hosts: [] });
});

test("configure Relay: Host still requires Token on LAN and registers with hostname by default", async (t) => {
  const stateDir = mkdtempSync(join(tmpdir(), "cr-host-"));
  t.after(() => rmSync(stateDir, { recursive: true, force: true }));

  const relayPort = await freePort();
  const hostPort = await freePort();
  const relay = collectProc(
    spawn(process.execPath, [relayCli, "--dev", "--port", String(relayPort), "--host", "127.0.0.1"], {
      cwd: root,
      env: cleanEnv({ LOGIN_USERNAME: "relay-user", LOGIN_PASSWORD: "correct-horse" }),
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  t.after(() => stopProc(relay));
  await waitForStdout(relay, /Press Ctrl\+C to stop/, 60_000);

  const host = collectProc(
    spawn(
      process.execPath,
      [
        hostCli,
        "--dev",
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
      {
        cwd: root,
        env: cleanEnv({ CURSOR_REMOTE_STATE_DIR: stateDir }),
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
  );
  t.after(() => stopProc(host));
  await waitForStdout(host, /Ready/, 60_000);

  const denied = await fetch(`http://127.0.0.1:${hostPort}/api/info`);
  assert.equal(denied.status, 401);

  const cookie = await loginCookie(relayPort);
  const body = await waitForHostRow(relayPort, cookie);
  assert.equal(body.hosts[0].online, true);
  assert.equal(body.hosts[0].name, osHostname());
  assert.equal(typeof body.hosts[0].id, "string");
  assert.ok(body.hosts[0].id.length > 0);

  const proxied = await fetch(`http://127.0.0.1:${relayPort}/h/${body.hosts[0].id}/api/info`, {
    headers: { cookie },
  });
  assert.equal(proxied.status, 200);
  const info = (await proxied.json()) as { workspace?: string };
  assert.ok(info.workspace);
});

test("second Host start on the same PC refuses and prints the existing local URL", async (t) => {
  const stateDir = mkdtempSync(join(tmpdir(), "cr-host-"));
  t.after(() => rmSync(stateDir, { recursive: true, force: true }));

  const hostPort = await freePort();
  const first = collectProc(
    spawn(
      process.execPath,
      [hostCli, "--dev", "--port", String(hostPort), "--host", "127.0.0.1", "--no-open", "--no-qr", "--token", "lan-token"],
      {
        cwd: root,
        env: cleanEnv({ CURSOR_REMOTE_STATE_DIR: stateDir }),
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
  );
  t.after(() => stopProc(first));
  await waitForStdout(first, /Ready/, 60_000);

  const secondPort = await freePort();
  const second = collectProc(
    spawn(process.execPath, [hostCli, "--dev", "--port", String(secondPort), "--host", "127.0.0.1", "--no-open", "--no-qr"], {
      cwd: root,
      env: cleanEnv({ CURSOR_REMOTE_STATE_DIR: stateDir }),
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );

  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const timer = setTimeout(() => {
        second.child.kill("SIGTERM");
        reject(new Error(`second Host did not exit. stdout=${second.stdout()} stderr=${second.stderr()}`));
      }, 15_000);
      second.child.once("exit", (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal, stdout: second.stdout(), stderr: second.stderr() });
      });
    },
  );
  assert.notEqual(exit.code, 0);
  const out = `${exit.stdout}${exit.stderr}`;
  assert.match(out, new RegExp(`http://localhost:${hostPort}\\b`));
});
});
