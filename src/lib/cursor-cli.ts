import { spawn, execFileSync, type ChildProcess } from "child_process";
import type { AgentMode } from "@/lib/types";
import { getConfig } from "@/lib/session-store";
import { buildAgentArgv } from "@/lib/agent-argv.mjs";

let agentChecked = false;

function ensureAgentOnPath(): void {
  if (agentChecked) return;
  try {
    execFileSync("agent", ["--version"], { stdio: "ignore", timeout: 5_000 });
    agentChecked = true;
  } catch {
    throw new Error(
      "Could not find the 'agent' CLI. Make sure Cursor is installed and the CLI is on your PATH.",
    );
  }
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
  ensureAgentOnPath();
  const args = buildAgentArgv(options, { trust: await shouldTrust() });

  return spawn("agent", args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });
}

