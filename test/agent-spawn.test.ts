import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAgentArgv } from "../src/lib/agent-argv";
import { isValidModelId } from "../src/lib/model-id";

test("spawn --model includes effort when the Client sent it and never uses --effort", () => {
  const argv = buildAgentArgv(
    {
      prompt: "hello",
      model: "composer-1[effort=high]",
      mode: "ask",
      workspace: "/ws/app",
    },
    { force: false },
  );

  assert.ok(argv.includes("--trust"));
  const modelIdx = argv.indexOf("--model");
  assert.ok(modelIdx >= 0);
  assert.equal(argv[modelIdx + 1], "composer-1[effort=high]");
  assert.equal(argv.includes("--effort"), false);
  assert.equal(argv.includes("effort"), false);
  const modeIdx = argv.indexOf("--mode");
  assert.ok(modeIdx >= 0);
  assert.equal(argv[modeIdx + 1], "ask");
});

test("catalog slugs pass through as --model", () => {
  const argv = buildAgentArgv({ prompt: "hi", model: "composer-1" }, { force: false });
  assert.equal(argv[argv.indexOf("--model") + 1], "composer-1");
  assert.ok(argv.includes("--trust"));
  assert.equal(argv.includes("--force"), false);
});

test("force flag adds --force and --trust is always present", () => {
  const argv = buildAgentArgv({ prompt: "hi" }, { force: true });
  assert.ok(argv.includes("--trust"));
  assert.ok(argv.includes("--force"));
});

test("Client-sent effort-bearing model ids are accepted at the HTTP seam", () => {
  assert.equal(isValidModelId("composer-1[effort=high]"), true);
  assert.equal(isValidModelId("gpt-5[effort=medium]"), true);
  assert.equal(isValidModelId("composer-1"), true);
  assert.equal(isValidModelId("bad model"), false);
});
