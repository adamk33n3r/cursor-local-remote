import assert from "node:assert/strict";
import { createServer } from "node:http";
import { connect as connectTcp } from "node:net";
import { test } from "node:test";
import { attachTunnel } from "../packages/cursor-remote-relay/lib/tunnel";

function websocketUpgradeRequest(pathname: string): string {
  return [
    `GET ${pathname} HTTP/1.1`,
    "Host: 127.0.0.1",
    "Upgrade: websocket",
    "Connection: Upgrade",
    "Sec-WebSocket-Version: 13",
    "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
    "",
    "",
  ].join("\r\n");
}

function listen(): Promise<{ port: number; close: () => Promise<void>; hangingCalls: number[] }> {
  const hangingCalls: number[] = [];
  const server = createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });
  attachTunnel(server, () => {
    hangingCalls.push(Date.now());
  });
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        port,
        hangingCalls,
        close: () =>
          new Promise<void>((resClose, rejClose) => {
            server.close((err) => (err ? rejClose(err) : resClose()));
          }),
      });
    });
    server.once("error", reject);
  });
}

function rawUpgrade(
  port: number,
  pathname: string,
  timeoutMs: number,
): Promise<{ statusLine: string | "connection-closed"; elapsedMs: number }> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const socket = connectTcp({ port, host: "127.0.0.1" });
    let buf = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`timed out waiting for ${pathname}; got ${JSON.stringify(buf)}`));
    }, timeoutMs);
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buf += chunk;
      const end = buf.indexOf("\r\n");
      if (end === -1) return;
      clearTimeout(timer);
      socket.destroy();
      resolve({ statusLine: buf.slice(0, end), elapsedMs: Date.now() - started });
    });
    socket.on("close", () => {
      clearTimeout(timer);
      if (buf.includes("\r\n")) return;
      resolve({ statusLine: "connection-closed", elapsedMs: Date.now() - started });
    });
    socket.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    socket.on("connect", () => {
      socket.write(websocketUpgradeRequest(pathname));
    });
  });
}

test("Host list live upgrade returns 101 without waiting on Login HMAC", async (t) => {
  const srv = await listen();
  t.after(() => srv.close());
  const live = await rawUpgrade(srv.port, "/api/hosts/live", 1_000);
  assert.equal(live.statusLine, "HTTP/1.1 101 Switching Protocols");
  assert.ok(live.elapsedMs < 500, `live 101 took ${live.elapsedMs}ms`);
});

test("unmatched Host API upgrades 404 instead of hanging in Next", async (t) => {
  const srv = await listen();
  t.after(() => srv.close());
  const listed = await rawUpgrade(srv.port, "/api/terminal/list", 1_000);
  assert.equal(listed.statusLine, "HTTP/1.1 404 Not Found");
  assert.equal(srv.hangingCalls.length, 0);
});
