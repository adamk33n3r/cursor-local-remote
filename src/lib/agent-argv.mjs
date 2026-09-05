/**
 * Build the Agent CLI argv. Effort is only ever part of --model.
 *
 * @param {{
 *   prompt: string,
 *   sessionId?: string,
 *   workspace?: string,
 *   model?: string,
 *   mode?: string,
 * }} options
 * @param {{ trust: boolean }} flags
 * @returns {string[]}
 */
export function buildAgentArgv(options, flags) {
  const args = ["-p", options.prompt, "--output-format", "stream-json", "--stream-partial-output"];

  if (flags.trust) {
    args.push("--trust");
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
