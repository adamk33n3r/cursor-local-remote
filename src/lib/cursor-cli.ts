import { spawn, execFileSync, type ChildProcess } from "child_process";
import type { AgentMode } from "@/lib/types";
import { resolveAgentBin, type ResolvedAgent } from "@/lib/agent-bin";
import { getConfig } from "@/lib/session-store";
import { buildAgentArgv } from "@/lib/agent-argv";

let resolved: ResolvedAgent | null = null;

function agentLaunch(): ResolvedAgent {
  if (resolved) return resolved;
  const candidate = resolveAgentBin();
  try {
    execFileSync(candidate.command, [...candidate.prefixArgs, "--version"], {
      stdio: ["ignore", "ignore", "pipe"],
      timeout: 8_000,
      windowsHide: true,
      env: { ...process.env, ...candidate.extraEnv },
    });
  } catch (err) {
    const stderr =
      err && typeof err === "object" && "stderr" in err
        ? String((err as { stderr?: Buffer | string }).stderr ?? "").trim()
        : "";
    const code =
      err && typeof err === "object" && "status" in err
        ? String((err as { status?: number | null }).status)
        : "";
    throw new Error(
      `Cursor Agent CLI failed (${candidate.command} --version)${code ? ` status=${code}` : ""}${stderr ? `: ${stderr}` : ""}`,
      { cause: err },
    );
  }
  resolved = candidate;
  return candidate;
}

export interface AgentOptions {
  prompt: string;
  sessionId?: string;
  workspace?: string;
  model?: string;
  mode?: AgentMode;
}

/** Host settings key `trust` and CURSOR_FORCE=1/0 control Agent `--force`. `--trust` is always passed. */
export async function shouldForce(): Promise<boolean> {
  if (process.env.CURSOR_FORCE === "0") return false;
  if (process.env.CURSOR_FORCE === "1") return true;
  return (await getConfig("trust")) === "1";
}

export async function spawnAgent(options: AgentOptions): Promise<ChildProcess> {
  const agent = agentLaunch();
  const args = [
    ...agent.prefixArgs,
    ...buildAgentArgv(options, { force: await shouldForce() }),
  ];

  return spawn(agent.command, args, {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env: { ...process.env, ...agent.extraEnv },
  });
}

export function agentExecFile() {
  return agentLaunch();
}
