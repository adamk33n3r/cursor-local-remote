import assert from "node:assert/strict";
import { test } from "node:test";
import { foldSameRoleText, mergeMessageLists, overlayToolCallResults, parseLiveEvents } from "../src/lib/transcript-reader";
import { displayTranscriptText, normalizeUserPrompt } from "../src/lib/transcript-text";

test("foldSameRoleText keeps a growing snapshot instead of concatenating", () => {
  assert.equal(foldSameRoleText("pong", "pong"), "pong");
  assert.equal(foldSameRoleText("po", "pong"), "pong");
  assert.equal(foldSameRoleText("pong", "po"), "pong");
  assert.equal(foldSameRoleText("hello ", "world"), "hello world");
});

test("foldSameRoleText treats trailing whitespace as the same snapshot", () => {
  assert.equal(foldSameRoleText("Pong.", "Pong.\n"), "Pong.\n");
  assert.equal(foldSameRoleText("Pong.\n", "Pong."), "Pong.\n");
});

test("parseLiveEvents replaces thinking with the real assistant reply", () => {
  const { messages } = parseLiveEvents(
    [
      { type: "thinking", text: "planning the story" },
      { type: "assistant", message: { content: [{ type: "text", text: "Once upon a time" }] } },
    ],
    "sess",
  );
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.content, "Once upon a time");
});

test("displayTranscriptText drops Cursor wrappers and [REDACTED]", () => {
  const raw = "<timestamp>Friday, Sep 4, 2026, 11:48 PM (UTC-4)</timestamp>\n<user_query>\nthat was great\n</user_query>";
  assert.equal(displayTranscriptText(raw), "that was great");
  assert.equal(
    displayTranscriptText("Glad it landed.\n\n[REDACTED]"),
    "Glad it landed.",
  );
  assert.equal(displayTranscriptText("see `[REDACTED]` here"), "see  here");
  assert.equal(normalizeUserPrompt(raw), "that was great");
});

test("displayTranscriptText keeps the user prompt and drops inlined skill bodies", () => {
  const raw = `<manually_attached_skills>
The user has manually attached the following skills to their message.
Skill Name: setup-matt-pocock-skills
SKILL.md content:
# Setup Matt Pocock's Skills
Only read the files if needed, the full skill content is inlined here.
</manually_attached_skills>
<timestamp>Monday, Sep 7, 2026, 7:00 PM (UTC-4)</timestamp>
<user_query>
ok run /setup-matt-pocock-skills
</user_query>`;
  assert.equal(displayTranscriptText(raw), "ok run /setup-matt-pocock-skills");
  assert.equal(normalizeUserPrompt(raw), "ok run /setup-matt-pocock-skills");
});

test("foldSameRoleText prefers the spaced snapshot over a compacted jumble", () => {
  const jumble = "Exploringtherepotoseewhat'salreadyconfigured.Exploring the repo to see what's already configured.**Exploration findings**|Item|Status|";
  const clean = "Exploring the repo to see what's already configured.\n\n**Exploration findings**\n\n| Item | Status |\n| --- | --- |";
  assert.equal(foldSameRoleText(jumble, clean), clean);
  assert.equal(foldSameRoleText("Exploring", "the"), "Exploring the");
});

test("mergeMessageLists does not glue a prior assistant turn onto the next one", () => {
  const findings = "## Exploration findings\n\n| Item | Status |\n|------|--------|\n| Git repo | **No** |";
  const complete = "Setup is complete. Here's what was created:\n\n| File | Purpose |\n|------|---------|\n| `AGENTS.md` | Agent skills index |";
  const merged = mergeMessageLists(
    [
      { id: "u1", role: "user", content: "/setup-matt-pocock-skills", timestamp: 1 },
      { id: "a1", role: "assistant", content: findings, timestamp: 2 },
      { id: "u2", role: "user", content: "use github. the rest of the defaults are good, create an AGENTS.md file", timestamp: 3 },
      { id: "a2", role: "assistant", content: complete, timestamp: 4 },
    ],
    [
      { id: "lu1", role: "user", content: "/setup-matt-pocock-skills", timestamp: 1 },
      { id: "la1", role: "assistant", content: `${findings}\n\n**Local markdown?**`, timestamp: 2 },
      { id: "lu2", role: "user", content: "use github. the rest of the defaults are good, create an AGENTS.md file", timestamp: 3 },
      { id: "la2", role: "assistant", content: complete, timestamp: 4 },
    ],
  );
  assert.equal(merged.length, 4);
  assert.equal(merged[1]?.content.includes("Exploration findings"), true);
  assert.equal(merged[3]?.content.startsWith("Setup is complete."), true);
  assert.equal(merged[3]?.content.includes("Exploration findings"), false);
});

test("parseLiveEvents does not double a repeated assistant snapshot", () => {
  const { messages } = parseLiveEvents(
    [
      { type: "assistant", message: { content: [{ type: "text", text: "pong" }] } },
      { type: "assistant", message: { content: [{ type: "text", text: "pong" }] } },
    ],
    "sess",
  );
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.content, "pong");
});

test("parseLiveEvents attaches shell stdout from tool_call completed events", () => {
  const { toolCalls } = parseLiveEvents(
    [
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Shell",
              input: { command: "gh repo view adamk33n3r/cursor-local-remote" },
            },
          ],
        },
      },
      {
        type: "tool_call",
        subtype: "started",
        call_id: "toolu_shell_1",
        tool_call: {
          shellToolCall: {
            args: { command: "gh repo view adamk33n3r/cursor-local-remote" },
          },
        },
      },
      {
        type: "tool_call",
        subtype: "completed",
        call_id: "toolu_shell_1",
        tool_call: {
          shellToolCall: {
            args: { command: "gh repo view adamk33n3r/cursor-local-remote" },
            result: {
              success: {
                command: "gh repo view adamk33n3r/cursor-local-remote",
                exitCode: 0,
                stdout: "name: cursor-local-remote\ndescription: Host + Relay",
                stderr: "",
              },
            },
          },
        },
      },
    ],
    "sess",
  );
  assert.equal(toolCalls.length, 1);
  assert.equal(toolCalls[0]?.type, "shell");
  assert.equal(toolCalls[0]?.command, "gh repo view adamk33n3r/cursor-local-remote");
  assert.equal(toolCalls[0]?.status, "completed");
  assert.equal(toolCalls[0]?.output, "name: cursor-local-remote\ndescription: Host + Relay");
  assert.equal(toolCalls[0]?.result, "exit 0 · 2 lines");
});

test("parseLiveEvents keeps a running shell tool until it completes", () => {
  const { toolCalls } = parseLiveEvents(
    [
      {
        type: "tool_call",
        subtype: "started",
        call_id: "toolu_shell_2",
        tool_call: { shellToolCall: { args: { command: "sleep 5" } } },
      },
    ],
    "sess",
  );
  assert.equal(toolCalls.length, 1);
  assert.equal(toolCalls[0]?.status, "running");
  assert.equal(toolCalls[0]?.command, "sleep 5");
  assert.equal(toolCalls[0]?.output, undefined);
});

test("overlayToolCallResults copies stream output onto jsonl shell tools", () => {
  const overlaid = overlayToolCallResults(
    [
      {
        id: "file-1",
        callId: "file-1",
        type: "shell",
        name: "Shell",
        command: "gh repo view adamk33n3r/cursor-local-remote",
        status: "completed",
        timestamp: 1,
      },
    ],
    [
      {
        id: "toolu_shell_1",
        callId: "toolu_shell_1",
        type: "shell",
        name: "shellToolCall",
        command: "gh repo view adamk33n3r/cursor-local-remote",
        status: "completed",
        result: "exit 0 · 1 line",
        output: "name: cursor-local-remote",
        timestamp: 2,
      },
    ],
  );
  assert.equal(overlaid.length, 1);
  assert.equal(overlaid[0]?.id, "file-1");
  assert.equal(overlaid[0]?.output, "name: cursor-local-remote");
  assert.equal(overlaid[0]?.result, "exit 0 · 1 line");
});

test("overlayToolCallResults attaches stream output to the latest matching shell", () => {
  const overlaid = overlayToolCallResults(
    [
      {
        id: "file-1",
        callId: "file-1",
        type: "shell",
        name: "Shell",
        command: "gh repo view adamk33n3r/cooking-game --json name,visibility,isEmpty,defaultBranchRef,url",
        status: "completed",
        timestamp: 1,
      },
      {
        id: "file-2",
        callId: "file-2",
        type: "shell",
        name: "Shell",
        command: "gh repo view adamk33n3r/cooking-game --json name,visibility,isEmpty,defaultBranchRef,url",
        status: "completed",
        timestamp: 2,
      },
    ],
    [
      {
        id: "tool_latest",
        callId: "tool_latest",
        type: "shell",
        name: "Shell",
        command: "gh repo view adamk33n3r/cooking-game --json name,visibility,isEmpty,defaultBranchRef,url",
        status: "completed",
        result: "exit 0 · 1 line",
        output: "{\"name\":\"cooking-game\",\"visibility\":\"PRIVATE\"}",
        timestamp: 3,
      },
    ],
  );
  assert.equal(overlaid.length, 2);
  assert.equal(overlaid[0]?.output, undefined);
  assert.equal(overlaid[1]?.output, "{\"name\":\"cooking-game\",\"visibility\":\"PRIVATE\"}");
});

test("parseLiveEvents keeps a final assistant snapshot instead of concatenating deltas", () => {
  const { messages } = parseLiveEvents(
    [
      {
        type: "assistant",
        timestamp_ms: 1,
        message: { content: [{ type: "text", text: "```json\n{\"name\":\"cooking-game\"}" }] },
      },
      {
        type: "assistant",
        timestamp_ms: 2,
        message: { content: [{ type: "text", text: "\n```\n\nStill empty, private, and with no default branch set." }] },
      },
      {
        type: "assistant",
        message: {
          content: [{
            type: "text",
            text: "```json\n{\"name\":\"cooking-game\"}\n```\n\nStill empty, private, and with no default branch set.",
          }],
        },
      },
    ],
    "sess",
  );
  assert.equal(messages.length, 1);
  assert.equal(
    messages[0]?.content,
    "```json\n{\"name\":\"cooking-game\"}\n```\n\nStill empty, private, and with no default branch set.",
  );
});

test("parseLiveEvents strips [REDACTED] from assistant text", () => {
  const { messages } = parseLiveEvents(
    [
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "Glad it landed.\n\n[REDACTED]" }] },
      },
    ],
    "sess",
  );
  assert.equal(messages[0]?.content, "Glad it landed.");
});
