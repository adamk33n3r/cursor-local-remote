import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { GET as getFs, POST as postFs } from "../src/app/api/fs/route";
import { GET as getInfo } from "../src/app/api/info/route";
import { GET as getSessions } from "../src/app/api/sessions/route";
import { GET as getGit } from "../src/app/api/git/route";

const startDirectory = mkdtempSync(join(tmpdir(), "cr-open-ws-start-"));
const nested = join(startDirectory, "nested");
const filePath = join(startDirectory, "readme.txt");
mkdirSync(nested);
writeFileSync(filePath, "not a folder");

const previousWorkspace = process.env.CURSOR_WORKSPACE;
process.env.CURSOR_WORKSPACE = startDirectory;

after(() => {
  if (previousWorkspace === undefined) delete process.env.CURSOR_WORKSPACE;
  else process.env.CURSOR_WORKSPACE = previousWorkspace;
  rmSync(startDirectory, { recursive: true, force: true });
});

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

test("disk browser lists directories at the Start directory and ignores files", async () => {
  const res = await getFs(new Request("http://host/api/fs"));
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.path, resolve(startDirectory));
  assert.equal(body.startDirectory, resolve(startDirectory));
  const entries = body.entries as { name: string; path: string }[];
  assert.deepEqual(entries.map((e) => e.name).sort(), ["nested"]);
  assert.equal(entries[0].path, resolve(nested));
  assert.equal(
    entries.some((e) => e.name === "readme.txt"),
    false,
  );
});

test("listing a folder returns its path and a parent to navigate up", async () => {
  const res = await getFs(new Request(`http://host/api/fs?path=${encodeURIComponent(nested)}`));
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.path, resolve(nested));
  assert.equal(body.parent, resolve(startDirectory));
});

test(
  "Windows drive root lists a parent that is the drive letter listing",
  { skip: process.platform !== "win32" },
  async () => {
    const res = await getFs(new Request("http://host/api/fs?path=C%3A%5C"));
    assert.equal(res.status, 200);
    const body = await json(res);
    assert.equal(body.parent, "");
    const drives = await getFs(new Request("http://host/api/fs?path="));
    assert.equal(drives.status, 200);
    const driveBody = await json(drives);
    const entries = driveBody.entries as { name: string; path: string }[];
    assert.ok(entries.some((e) => e.path === "C:\\" || e.name === "C:"));
  },
);

test("New folder creates a leaf in the current listing", async () => {
  const res = await postFs(
    new Request("http://host/api/fs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mkdir", path: startDirectory, name: "leaf-ws" }),
    }),
  );
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.path, resolve(join(startDirectory, "leaf-ws")));
  const listing = await json(await getFs(new Request("http://host/api/fs")));
  const names = (listing.entries as { name: string }[]).map((e) => e.name).sort();
  assert.ok(names.includes("leaf-ws"));
  assert.ok(names.includes("nested"));
});

test("New folder rejects a path that is not a single leaf name", async () => {
  const res = await postFs(
    new Request("http://host/api/fs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mkdir", path: startDirectory, name: "a/b" }),
    }),
  );
  assert.equal(res.status, 400);
  const listing = await json(await getFs(new Request("http://host/api/fs")));
  const names = (listing.entries as { name: string }[]).map((e) => e.name);
  assert.equal(names.includes("a"), false);
});

test("Open Workspace starts a Session at that path and leaves the process default Workspace unchanged", async () => {
  execFileSync("git", ["init", "-b", "open-ws-test"], { cwd: nested, stdio: "ignore" });
  execFileSync(
    "git",
    [
      "-c",
      "user.email=test@example.com",
      "-c",
      "user.name=Test",
      "commit",
      "--allow-empty",
      "-m",
      "init",
    ],
    { cwd: nested, stdio: "ignore" },
  );
  const cwdBefore = process.cwd();

  const openRes = await postFs(
    new Request("http://host/api/fs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "open", path: nested }),
    }),
  );
  assert.equal(openRes.status, 200);
  const opened = await json(openRes);
  assert.equal(opened.workspace, resolve(nested));
  assert.equal(opened.startDirectory, resolve(startDirectory));
  assert.equal(process.env.CURSOR_WORKSPACE, startDirectory);
  assert.equal(process.cwd(), cwdBefore);

  const info = await json(await getInfo());
  assert.equal(info.workspace, resolve(startDirectory));

  const sessions = await json(
    await getSessions(
      new Request(`http://host/api/sessions?workspace=${encodeURIComponent(nested)}`),
    ),
  );
  assert.equal(sessions.workspace, nested);

  const git = await json(
    await getGit(new Request(`http://host/api/git?workspace=${encodeURIComponent(nested)}`)),
  );
  assert.equal(git.branch, "open-ws-test");

  const startGit = await json(await getGit(new Request("http://host/api/git")));
  assert.equal(startGit.branch, null);
});

test("opening a file is a Session-start failure and does not roll back a folder already created", async () => {
  const mkdirRes = await postFs(
    new Request("http://host/api/fs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mkdir", path: startDirectory, name: "kept-folder" }),
    }),
  );
  assert.equal(mkdirRes.status, 200);

  const openRes = await postFs(
    new Request("http://host/api/fs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "open", path: filePath }),
    }),
  );
  assert.equal(openRes.status, 400);
  const body = await json(openRes);
  assert.equal(typeof body.error, "string");

  const listing = await json(await getFs(new Request("http://host/api/fs")));
  const names = (listing.entries as { name: string }[]).map((e) => e.name);
  assert.ok(names.includes("kept-folder"));
});
