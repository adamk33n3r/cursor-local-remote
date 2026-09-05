import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { getLanIp } from "../packages/cursor-remote-relay/lib/lan-ip.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const relayCli = join(root, "packages", "cursor-remote-relay", "bin", "cursor-remote-relay.mjs");

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

function relayEnv(overrides = {}) {
  const env = { ...process.env };
  delete env.LOGIN_USERNAME;
  delete env.LOGIN_PASSWORD;
  delete env.PORT;
  delete env.HOST;
  return { ...env, ...overrides };
}

/**
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} env
 */
function startRelay(args, env) {
  const child = spawn(process.execPath, [relayCli, ...args], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  return {
    child,
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

function waitForStdout(proc, pattern, timeoutMs = 8_000) {
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
        proc.child.stdout.off("data", check);
        resolve(proc.stdout());
      }
    };
    proc.child.stdout.on("data", check);
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

async function stopRelay(proc) {
  const { child } = proc;
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
  });
}

test("unset Login: process stays up; Host list and Login are not served; stdout says so", async (t) => {
  const port = await freePort();
  const proc = startRelay(["--port", String(port)], relayEnv());
  t.after(() => stopRelay(proc));

  const stdout = await waitForStdout(proc, /Host list will not be served/i);
  assert.equal(proc.child.exitCode, null);
  assert.match(stdout, /until .+ (are )?set/i);

  const listRes = await fetch(`http://127.0.0.1:${port}/`);
  assert.notEqual(listRes.status, 200);
  const listBody = await listRes.text();
  assert.doesNotMatch(listBody, /<form/i);

  const loginRes = await fetch(`http://127.0.0.1:${port}/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "username=anyone&password=secret",
  });
  assert.notEqual(loginRes.status, 200);
  assert.equal(loginRes.headers.getSetCookie().length, 0);
});

test("stdout prints localhost and LAN Host-list URLs only, with no Token or Login password", async (t) => {
  const port = await freePort();
  const password = "relay-pass-do-not-print";
  const proc = startRelay(
    ["--port", String(port)],
    relayEnv({
      HOST: "127.0.0.1",
      LOGIN_USERNAME: "relay-user",
      LOGIN_PASSWORD: password,
    }),
  );
  t.after(() => stopRelay(proc));

  const stdout = await waitForStdout(proc, /Press Ctrl\+C to stop/, 60_000);
  assert.match(stdout, new RegExp(`http://localhost:${port}\\b`));
  assert.doesNotMatch(stdout, /token/i);
  assert.doesNotMatch(stdout, /QR/i);
  assert.doesNotMatch(stdout, new RegExp(password));

  const lanIp = await getLanIp();
  if (lanIp) {
    const lanUrl = `http://${lanIp}:${port}`;
    assert.match(stdout, new RegExp(`http://${lanIp.replaceAll(".", "\\.")}:${port}\\b`));
    const lanRes = await fetch(lanUrl);
    assert.ok(lanRes.status > 0, `Relay should accept LAN clients at ${lanUrl}`);
  }

  const loopback = await fetch(`http://127.0.0.1:${port}/`);
  assert.ok(loopback.status > 0);
});

const SEVEN_DAYS_S = 60 * 60 * 24 * 7;

test("set Login: HttpOnly cookie lasts seven days and Host list is empty", async (t) => {
  const port = await freePort();
  const proc = startRelay(
    ["--port", String(port)],
    relayEnv({ LOGIN_USERNAME: "relay-user", LOGIN_PASSWORD: "correct-horse" }),
  );
  t.after(() => stopRelay(proc));
  await waitForStdout(proc, /Press Ctrl\+C to stop/, 60_000);

  const splash = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(splash.status, 200);
  const splashHtml = await splash.text();
  assert.match(splashHtml, /<form/i);
  assert.match(splashHtml, /Login/i);
  assert.doesNotMatch(splashHtml, /signup/i);

  const denied = await fetch(`http://127.0.0.1:${port}/hosts`);
  assert.equal(denied.status, 401);

  const wrong = await fetch(`http://127.0.0.1:${port}/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    redirect: "manual",
    body: "username=relay-user&password=wrong",
  });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.headers.getSetCookie().length, 0);

  const loginRes = await fetch(`http://127.0.0.1:${port}/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    redirect: "manual",
    body: "username=relay-user&password=correct-horse",
  });
  assert.ok(loginRes.status === 302 || loginRes.status === 303);
  const cookies = loginRes.headers.getSetCookie();
  const cookie = cookies.find((c) => c.startsWith("cr_login="));
  assert.ok(cookie, `expected cr_login Set-Cookie, got ${JSON.stringify(cookies)}`);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, new RegExp(`Max-Age=${SEVEN_DAYS_S}\\b`, "i"));
  assert.doesNotMatch(cookie, /correct-horse/);

  const cookieHeader = cookie.split(";")[0];
  const listRes = await fetch(`http://127.0.0.1:${port}/hosts`, {
    headers: { cookie: cookieHeader },
  });
  assert.equal(listRes.status, 200);
  const listHtml = await listRes.text();
  assert.match(listHtml, /Host/i);
  assert.match(listHtml, /Logout/i);
  assert.doesNotMatch(listHtml, /data-host-id=/);
  const hostRows = listHtml.match(/data-host-row/g) ?? [];
  assert.equal(hostRows.length, 0);

  const hostsJson = await fetch(`http://127.0.0.1:${port}/api/hosts`, {
    headers: { cookie: cookieHeader },
  });
  assert.equal(hostsJson.status, 200);
  assert.deepEqual(await hostsJson.json(), { hosts: [] });

  const logoutRes = await fetch(`http://127.0.0.1:${port}/logout`, {
    method: "POST",
    headers: { cookie: cookieHeader },
    redirect: "manual",
  });
  assert.ok(logoutRes.status === 302 || logoutRes.status === 303);
  const afterLogout = await fetch(`http://127.0.0.1:${port}/hosts`);
  assert.equal(afterLogout.status, 401);
});

test("Login username and password can come from a config file", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "relay-config-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const configPath = join(dir, "relay.json");
  writeFileSync(configPath, JSON.stringify({ username: "cfg-user", password: "cfg-pass" }));

  const port = await freePort();
  const proc = startRelay(["--port", String(port), "--config", configPath], relayEnv());
  t.after(() => stopRelay(proc));
  await waitForStdout(proc, /Press Ctrl\+C to stop/, 60_000);

  const loginRes = await fetch(`http://127.0.0.1:${port}/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    redirect: "manual",
    body: "username=cfg-user&password=cfg-pass",
  });
  assert.ok(loginRes.status === 302 || loginRes.status === 303);
  const cookies = loginRes.headers.getSetCookie();
  assert.ok(
    cookies.some((c) => c.startsWith("cr_login=")),
    `expected cr_login Set-Cookie, got ${JSON.stringify(cookies)}`,
  );
});

test("starting Relay never starts a Host", async (t) => {
  const port = await freePort();
  const proc = startRelay(
    ["--port", String(port)],
    relayEnv({ LOGIN_USERNAME: "relay-user", LOGIN_PASSWORD: "correct-horse" }),
  );
  t.after(() => stopRelay(proc));
  const stdout = await waitForStdout(proc, /Press Ctrl\+C to stop/, 60_000);

  assert.doesNotMatch(stdout, /Workspace:/);
  assert.doesNotMatch(stdout, /Auth token:/);
  assert.equal(proc.child.spawnfile, process.execPath);
  assert.equal(proc.child.spawnargs[1], relayCli);

  const hostInfo = await fetch(`http://127.0.0.1:${port}/api/info`);
  assert.equal(hostInfo.status, 404);
});
