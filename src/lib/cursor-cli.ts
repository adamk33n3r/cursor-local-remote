import { spawn, execFileSync, type ChildProcess } from "child_process";
import type { AgentMode } from "@/lib/types";
import { resolveAgentBin, type ResolvedAgent } from "@/lib/agent-bin";
import { getConfig } from "@/lib/session-store";
import { buildAgentArgv } from "@/lib/agent-argv";

let resolved: ResolvedAgent | null = null;

function agentLaunch(): ResolvedAgent {
  if (resolved) return resolved;
  const candidate = resolveAgentBin();
  execFileSync(candidate.command, [...candidate.prefixArgs, "--version"], {
    stdio: "ignore",
    timeout: 8_000,
    windowsHide: true,
    env: { ...process.env, ...candidate.extraEnv },
  });
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

async function shouldTrust(): Promise<boolean> {
  if (process.env.CURSOR_TRUST === "0") return false;
  if (process.env.CURSOR_TRUST === "1") return true;
  const val = await getConfig("trust");
  return val !== "0";
}

export async function spawnAgent(options: AgentOptions): Promise<ChildProcess> {
  const agent = agentLaunch();
  const args = [
    ...agent.prefixArgs,
    ...buildAgentArgv(options, { trust: await shouldTrust() }),
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
