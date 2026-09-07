import { appendFileSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { getHostDataDir } from "@/lib/list-session-workspaces.mjs";

function toolCallDir(): string {
  return join(getHostDataDir(), "tool-calls");
}

function toolCallPath(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return join(toolCallDir(), `${safe}.jsonl`);
}

export function appendToolCallEvent(sessionId: string, event: Record<string, unknown>): void {
  mkdirSync(toolCallDir(), { recursive: true });
  appendFileSync(toolCallPath(sessionId), `${JSON.stringify(event)}\n`, "utf8");
}

export function readToolCallEvents(sessionId: string): Record<string, unknown>[] {
  try {
    const content = readFileSync(toolCallPath(sessionId), "utf8");
    const events: Record<string, unknown>[] = [];
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line) as Record<string, unknown>);
      } catch {
        continue;
      }
    }
    return events;
  } catch {
    return [];
  }
}
