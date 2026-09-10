import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import pathPosix from "node:path/posix";
import pathWin32 from "node:path/win32";

export interface ResolvedAgent {
  command: string;
  prefixArgs: string[];
  extraEnv: Record<string, string>;
}

export interface AgentBinFs {
  existsSync: (path: string) => boolean;
  readdirSync: (path: string) => string[];
}

type PathApi = {
  delimiter: string;
  join: (...parts: string[]) => string;
  dirname: (p: string) => string;
};

const VERSION_DIR_RE = /^(\d{4})\.(\d{1,2})\.(\d{1,2})(?:-(\d{2})-(\d{2})-(\d{2}))?-[a-f0-9]+$/i;

function defaultFs(): AgentBinFs {
  return {
    existsSync,
    readdirSync: (dir) => readdirSync(dir),
  };
}

function pathApi(win: boolean): PathApi {
  return win ? pathWin32 : pathPosix;
}

function pathDirs(env: NodeJS.ProcessEnv | Record<string, string | undefined>, delimiter: string): string[] {
  return (env.PATH || env.Path || "")
    .split(delimiter)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Sort key matching cursor-agent.ps1: newer YYYY.MM.DD (then build time) wins. */
export function agentVersionSortKey(name: string): number {
  const match = name.match(VERSION_DIR_RE);
  if (!match) return 0;
  const [, year, month, day, hour = "0", minute = "0", second = "0"] = match;
  return (
    Number(year) * 1e10 +
    Number(month) * 1e8 +
    Number(day) * 1e6 +
    Number(hour) * 1e4 +
    Number(minute) * 100 +
    Number(second)
  );
}

export function pickLatestAgentVersion(names: string[]): string | null {
  const ranked = names
    .filter((n) => VERSION_DIR_RE.test(n))
    .sort((a, b) => agentVersionSortKey(b) - agentVersionSortKey(a));
  return ranked[0] ?? null;
}

function unwrapCursorAgentInstall(installDir: string, fs: AgentBinFs, p: PathApi): ResolvedAgent | null {
  const versionsDir = p.join(installDir, "versions");
  if (!fs.existsSync(versionsDir)) return null;
  let names: string[];
  try {
    names = fs.readdirSync(versionsDir);
  } catch {
    return null;
  }
  const latest = pickLatestAgentVersion(names);
  if (!latest) return null;
  const nodePath = p.join(versionsDir, latest, "node.exe");
  const posixNode = p.join(versionsDir, latest, "node");
  const indexJs = p.join(versionsDir, latest, "index.js");
  const command = fs.existsSync(nodePath) ? nodePath : fs.existsSync(posixNode) ? posixNode : null;
  if (!command || !fs.existsSync(indexJs)) return null;
  return {
    command,
    prefixArgs: [indexJs],
    extraEnv: { CURSOR_INVOKED_AS: "agent" },
  };
}

function winCmdLaunch(scriptPath: string, env: NodeJS.ProcessEnv | Record<string, string | undefined>): ResolvedAgent {
  return {
    command: env.ComSpec || "cmd.exe",
    prefixArgs: ["/d", "/s", "/c", scriptPath],
    extraEnv: {},
  };
}

function candidatesFromDir(dir: string, win: boolean, p: PathApi): string[] {
  if (win) {
    return [
      p.join(dir, "agent.exe"),
      p.join(dir, "agent.cmd"),
      p.join(dir, "cursor-agent.cmd"),
    ];
  }
  return [p.join(dir, "agent"), p.join(dir, "cursor-agent")];
}

function resolveFromInstallDir(
  dir: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  fs: AgentBinFs,
  win: boolean,
  p: PathApi,
): ResolvedAgent | null {
  const unwrapped = unwrapCursorAgentInstall(dir, fs, p);
  if (unwrapped) return unwrapped;
  if (win) {
    for (const script of [p.join(dir, "agent.cmd"), p.join(dir, "cursor-agent.cmd")]) {
      if (fs.existsSync(script)) return winCmdLaunch(script, env);
    }
  }
  const posix = p.join(dir, "agent");
  if (fs.existsSync(posix)) {
    return { command: posix, prefixArgs: [], extraEnv: {} };
  }
  return null;
}

/**
 * Node spawn/execFile on Windows does not run PATHEXT .cmd/.ps1 shims.
 * Cursor ships agent.cmd → PowerShell → versions/<ver>/node.exe index.js.
 * Prefer that node+index pair; fall back to cmd.exe /c agent.cmd.
 */
export function resolveAgentBin(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  fs: AgentBinFs = defaultFs(),
  platform: NodeJS.Platform = process.platform,
): ResolvedAgent {
  const win = platform === "win32";
  const p = pathApi(win);
  const override = env.CURSOR_AGENT?.trim();
  if (override && fs.existsSync(override)) {
    const fromInstall = resolveFromInstallDir(p.dirname(override), env, fs, win, p);
    if (fromInstall) return fromInstall;
    if (win && /\.(cmd|bat)$/i.test(override)) return winCmdLaunch(override, env);
    return { command: override, prefixArgs: [], extraEnv: {} };
  }

  const searchDirs = [...pathDirs(env, p.delimiter)];
  const localApp = env.LOCALAPPDATA || (win ? p.join(homedir(), "AppData", "Local") : "");
  if (localApp) searchDirs.push(p.join(localApp, "cursor-agent"));
  if (!win) searchDirs.push(p.join(homedir(), ".local", "bin"));

  for (const dir of searchDirs) {
    const fromDir = resolveFromInstallDir(dir, env, fs, win, p);
    if (fromDir) return fromDir;
    for (const file of candidatesFromDir(dir, win, p)) {
      if (!fs.existsSync(file)) continue;
      if (win && file.endsWith(".cmd")) return winCmdLaunch(file, env);
      return { command: file, prefixArgs: [], extraEnv: {} };
    }
  }

  throw new Error(
    "Could not find the Cursor Agent CLI. On Windows, Node cannot run the `agent` PATH shim (.cmd). Install Cursor Agent or set CURSOR_AGENT to agent.cmd (typically %LOCALAPPDATA%\\cursor-agent\\agent.cmd).",
  );
}
