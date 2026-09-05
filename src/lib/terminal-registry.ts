import { spawn, type ChildProcess } from "child_process";
import { randomUUID } from "crypto";

const MAX_OUTPUT_BYTES = 512 * 1024;

interface TerminalProcess {
  id: string;
  child: ChildProcess;
  cwd: string;
  output: string;
  running: boolean;
  exitCode: number | null;
  startedAt: number;
  listeners: Set<() => void>;
}

declare global {
  var __terminalRegistry: Map<string, TerminalProcess> | undefined; // eslint-disable-line no-var
}

const terminals = globalThis.__terminalRegistry ?? (globalThis.__terminalRegistry = new Map<string, TerminalProcess>());

const ENV_BLOCKLIST = new Set(["PORT", "AUTH_TOKEN"]);
const ENV_PREFIX_BLOCKLIST = ["__NEXT_", "NEXT_"];

function cleanEnv(): NodeJS.ProcessEnv {
  const base = { ...process.env };
  for (const key of Object.keys(base)) {
    if (ENV_BLOCKLIST.has(key) || ENV_PREFIX_BLOCKLIST.some((p) => key.startsWith(p))) {
      Reflect.deleteProperty(base, key);
    }
  }
  base.TERM = "xterm-256color";
  base.COLUMNS = "120";
  base.LINES = "30";
  return base;
}

function shellCommand(): { cmd: string; args: string[] } {
  if (process.platform === "win32") {
    return { cmd: process.env.ComSpec || "cmd.exe", args: [] };
  }
  return { cmd: process.env.SHELL || "/bin/sh", args: ["-i"] };
}

export function spawnTerminal(cwd: string): TerminalProcess {
  const id = randomUUID().slice(0, 8);
  const { cmd, args } = shellCommand();

  const child = spawn(cmd, args, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: cleanEnv(),
    detached: process.platform !== "win32",
  });

  const entry: TerminalProcess = {
    id,
    child,
    cwd,
    output: "",
    running: true,
    exitCode: null,
    startedAt: Date.now(),
    listeners: new Set(),
  };

  const appendOutput = (chunk: Buffer) => {
    const text = chunk.toString();
    entry.output += text;
    if (entry.output.length > MAX_OUTPUT_BYTES) {
      entry.output = entry.output.slice(-MAX_OUTPUT_BYTES);
    }
    for (const cb of entry.listeners) cb();
  };

  child.stdout?.on("data", appendOutput);
  child.stderr?.on("data", appendOutput);

  child.on("close", (code) => {
    entry.running = false;
    entry.exitCode = code;
    for (const cb of entry.listeners) cb();
  });

  child.on("error", (err) => {
    entry.running = false;
    entry.output += `\n[error] ${err.message}\n`;
    for (const cb of entry.listeners) cb();
  });

  terminals.set(id, entry);
  return entry;
}

export function getTerminal(id: string): TerminalProcess | undefined {
  return terminals.get(id);
}

export function listTerminals(): { id: string; cwd: string; running: boolean; exitCode: number | null; startedAt: number }[] {
  return Array.from(terminals.values()).map((t) => ({
    id: t.id,
    cwd: t.cwd,
    running: t.running,
    exitCode: t.exitCode,
    startedAt: t.startedAt,
  }));
}

function killProcessGroup(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}

export function signalTerminal(id: string, signal: NodeJS.Signals): boolean {
  const entry = terminals.get(id);
  if (!entry?.running || !entry.child.pid) return false;
  return killProcessGroup(entry.child.pid, signal) ||
    (() => { try { entry.child.kill(signal); return true; } catch { return false; } })();
}

export function killTerminal(id: string): boolean {
  const entry = terminals.get(id);
  if (!entry) return false;
  if (entry.running && entry.child.pid) {
    if (!killProcessGroup(entry.child.pid, "SIGTERM")) {
      try { entry.child.kill("SIGTERM"); } catch { /* already dead */ }
    }
    const pid = entry.child.pid;
    setTimeout(() => {
      if (!entry.running) return;
      if (!killProcessGroup(pid, "SIGKILL")) {
        try { entry.child.kill("SIGKILL"); } catch { /* already dead */ }
      }
    }, 3000);
  }
  return true;
}

export function removeTerminal(id: string): boolean {
  const entry = terminals.get(id);
  if (!entry) return false;
  if (entry.running) killTerminal(id);
  terminals.delete(id);
  return true;
}

export function writeToTerminal(id: string, data: string): boolean {
  const entry = terminals.get(id);
  if (!entry || !entry.running) return false;
  const stdin = entry.child.stdin;
  if (!stdin || stdin.destroyed) return false;
  // cmd.exe line-edits on CRLF; a bare LF is ignored and looks like Send did nothing.
  const payload = process.platform === "win32" && data !== "\x03"
    ? data.replace(/(?<!\r)\n/g, "\r\n")
    : data;
  return stdin.write(payload);
}

export function onTerminalOutput(id: string, cb: () => void): () => void {
  const entry = terminals.get(id);
  if (!entry) return () => {};
  entry.listeners.add(cb);
  return () => { entry.listeners.delete(cb); };
}

export function getTerminalOutput(id: string): string {
  return terminals.get(id)?.output ?? "";
}

export function killAllTerminals(): void {
  for (const entry of terminals.values()) {
    if (entry.running && entry.child.pid) {
      if (!killProcessGroup(entry.child.pid, "SIGTERM")) {
        try { entry.child.kill("SIGTERM"); } catch { /* already dead */ }
      }
    }
  }
}
