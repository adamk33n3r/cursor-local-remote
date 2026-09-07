import type { AgentMode } from "@/lib/types";

/** Options for the Agent CLI argv. Effort is only ever part of --model. */
export interface AgentArgvOptions {
  prompt: string;
  sessionId?: string;
  workspace?: string;
  model?: string;
  mode?: AgentMode;
}

export function buildAgentArgv(options: AgentArgvOptions, flags: { force: boolean }): string[] {
  const args = [
    "-p",
    options.prompt,
    "--output-format",
    "stream-json",
    "--stream-partial-output",
    "--trust",
  ];

  if (flags.force) {
    args.push("--force");
  }
  if (options.sessionId) {
    args.push("--resume", options.sessionId);
  }
  if (options.workspace) {
    args.push("--workspace", options.workspace);
  }
  if (options.model) {
    args.push("--model", options.model);
  }
  if (options.mode && options.mode !== "agent") {
    args.push("--mode", options.mode);
  }

  return args;
}
