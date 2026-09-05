import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function hostStateDir(): string {
  return process.env.CURSOR_REMOTE_STATE_DIR || join(homedir(), ".cursor-remote");
}

export function loadOrCreateHostId(stateDir = hostStateDir()): string {
  mkdirSync(stateDir, { recursive: true });
  const file = join(stateDir, "host-id");
  if (existsSync(file)) {
    const id = readFileSync(file, "utf8").trim();
    if (id) return id;
  }
  const id = randomUUID();
  writeFileSync(file, `${id}\n`, "utf8");
  return id;
}
