import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import { join } from "node:path";

export type ExistingHost = {
  url: string;
  port: number | null;
};

type HostLock = {
  pid?: unknown;
  port?: unknown;
  url?: unknown;
};

function lockPath(stateDir: string): string {
  return join(stateDir, "host.lock");
}

function pidAlive(pid: number): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function probeHost(port: number): Promise<{ port: number; url: string } | null> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/api/info`, { timeout: 800 }, (res) => {
      let body = "";
      res.on("data", (d: string | Buffer) => {
        body += d;
      });
      res.on("end", () => {
        try {
          const data: unknown = JSON.parse(body);
          const looksLikeHost =
            data !== null &&
            typeof data === "object" &&
            ("workspace" in data ||
              ("error" in data && (data as { error: unknown }).error === "Unauthorized") ||
              res.statusCode === 401);
          if (looksLikeHost) {
            resolve({ port, url: `http://localhost:${port}` });
            return;
          }
        } catch {
          /* not a Host */
        }
        resolve(null);
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

export async function findExistingHost(stateDir: string): Promise<ExistingHost | null> {
  const file = lockPath(stateDir);
  if (existsSync(file)) {
    try {
      const lock = JSON.parse(readFileSync(file, "utf8")) as HostLock;
      const port = Number(lock.port);
      if (Number.isInteger(port) && port > 0) {
        const live = await probeHost(port);
        if (live) {
          return { url: typeof lock.url === "string" && lock.url ? lock.url : live.url, port };
        }
      }
      if (pidAlive(Number(lock.pid)) && typeof lock.url === "string" && lock.url) {
        return { url: lock.url, port: Number(lock.port) || null };
      }
    } catch {
      /* stale or unreadable */
    }
  }
  return null;
}

export function writeHostLock(
  stateDir: string,
  info: { pid: number; port: number; url: string },
): void {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(lockPath(stateDir), `${JSON.stringify(info)}\n`, "utf8");
}

export function clearHostLock(stateDir: string): void {
  const file = lockPath(stateDir);
  if (!existsSync(file)) return;
  try {
    unlinkSync(file);
  } catch {
    /* best-effort */
  }
}
