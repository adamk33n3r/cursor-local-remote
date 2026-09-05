import assert from "node:assert/strict";
import { test } from "node:test";
import { foldSameRoleText, parseLiveEvents } from "../src/lib/transcript-reader";
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
