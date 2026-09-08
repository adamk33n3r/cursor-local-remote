import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSelectedWorkspace, sessionsListSearch } from "../src/lib/workspace-preference";

const list = [
  { path: "D:\\dev\\cooking-game" },
  { path: "D:\\dev\\cursor-local-remote" },
];

test("stored Workspace that still exists wins over Start directory", () => {
  assert.equal(
    resolveSelectedWorkspace(
      "D:\\dev\\cooking-game",
      list,
      "D:\\dev\\cursor-local-remote",
      true,
    ),
    "D:\\dev\\cooking-game",
  );
});

test("stored path canonicalizes to the listed Workspace path", () => {
  assert.equal(
    resolveSelectedWorkspace(
      "d:\\dev\\cooking-game",
      list,
      "D:\\dev\\cursor-local-remote",
      true,
    ),
    "D:\\dev\\cooking-game",
  );
});

test("Start directory is used when nothing is stored", () => {
  assert.equal(
    resolveSelectedWorkspace(null, list, "D:\\dev\\cursor-local-remote", true),
    "D:\\dev\\cursor-local-remote",
  );
});

test("Start directory is used when the stored Workspace is gone", () => {
  assert.equal(
    resolveSelectedWorkspace(
      "D:\\dev\\missing-app",
      list,
      "D:\\dev\\cursor-local-remote",
      true,
    ),
    "D:\\dev\\cursor-local-remote",
  );
});

test("All workspaces preference is kept", () => {
  assert.equal(
    resolveSelectedWorkspace("__all__", list, "D:\\dev\\cursor-local-remote", true),
    "__all__",
  );
});

test("sessions list is not fetched until a Workspace is chosen", () => {
  assert.equal(sessionsListSearch(null), null);
  assert.equal(sessionsListSearch(""), null);
});

test("sessions list query filters by Workspace or all", () => {
  assert.equal(
    sessionsListSearch("D:\\dev\\cooking-game"),
    "workspace=D%3A%5Cdev%5Ccooking-game",
  );
  assert.equal(sessionsListSearch("__all__"), "all=true");
  assert.equal(sessionsListSearch("D:\\dev\\cooking-game", true), "workspace=D%3A%5Cdev%5Ccooking-game&archived=true");
});
