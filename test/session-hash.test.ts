import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSessionHash, parseSessionHash } from "../src/lib/session-hash";

test("buildSessionHash writes session and workspace", () => {
  assert.equal(
    buildSessionHash({
      sessionId: "221f138b-599b-4cf0-b534-d9e049127777",
      workspace: "D:\\dev\\cooking-game",
    }),
    "#session=221f138b-599b-4cf0-b534-d9e049127777&workspace=D%3A%5Cdev%5Ccooking-game",
  );
});

test("buildSessionHash can omit session for a new chat in a Workspace", () => {
  assert.equal(
    buildSessionHash({ workspace: "D:\\dev\\cooking-game" }),
    "#workspace=D%3A%5Cdev%5Ccooking-game",
  );
});

test("parseSessionHash round-trips Windows Workspace paths", () => {
  const hash = buildSessionHash({
    sessionId: "221f138b-599b-4cf0-b534-d9e049127777",
    workspace: "D:\\dev\\cooking-game",
  });
  assert.deepEqual(parseSessionHash(hash), {
    sessionId: "221f138b-599b-4cf0-b534-d9e049127777",
    workspace: "D:\\dev\\cooking-game",
  });
});

test("parseSessionHash ignores a non-uuid session token", () => {
  assert.equal(parseSessionHash("#session=nope&workspace=/tmp").sessionId, null);
});
