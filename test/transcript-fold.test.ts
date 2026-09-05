import assert from "node:assert/strict";
import { test } from "node:test";
import { foldSameRoleText, parseLiveEvents } from "../src/lib/transcript-reader";

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
