import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { closeHttpServer } from "../packages/cursor-remote-relay/lib/stop-http";

test("closeHttpServer returns while a keep-alive client is still connected", async () => {
  const server = createServer((_req, res) => {
    res.end("ok");
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  const res = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(res.status, 200);
  await res.text();

  const started = Date.now();
  await closeHttpServer(server);
  assert.ok(Date.now() - started < 1_000, "shutdown waited on keep-alive instead of dropping it");
});
