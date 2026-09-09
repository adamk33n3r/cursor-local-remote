import assert from "node:assert/strict";
import { test } from "node:test";
import { startReconnectingWebSocket } from "../src/lib/reconnect-live-ws";

class FakeSocket {
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;

  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({});
  }

  drop(): void {
    this.readyState = 3;
    this.onclose?.({});
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

test("close does not open another live socket until the Relay probe succeeds", async (t) => {
  const sockets: FakeSocket[] = [];
  const pendingSleep: Array<{ resolve: () => void }> = [];
  let probeOk = false;
  const live = startReconnectingWebSocket({
    url: () => "ws://127.0.0.1/api/hosts/live",
    onMessage() {},
    reconnectMs: 1_000,
    handshakeRetryMs: 1_000,
    probe: async () => probeOk,
    sleep: () => new Promise((resolve) => pendingSleep.push({ resolve })),
    createWebSocket() {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  });
  t.after(() => live.stop());

  assert.equal(sockets.length, 1);
  sockets[0]!.drop();
  await flush();
  assert.equal(sockets.length, 1, "must not construct a live socket while the Relay is down");
  assert.equal(pendingSleep.length, 1);

  pendingSleep.shift()!.resolve();
  await flush();
  await flush();
  assert.equal(sockets.length, 1);
  assert.equal(pendingSleep.length, 1);

  probeOk = true;
  pendingSleep.shift()!.resolve();
  await flush();
  await flush();
  assert.equal(sockets.length, 2);
});

test("a live socket that reached OPEN reconnects after probe, not while CONNECTING", async (t) => {
  const sockets: FakeSocket[] = [];
  const pendingSleep: Array<{ resolve: () => void }> = [];
  const live = startReconnectingWebSocket({
    url: () => "ws://127.0.0.1/api/hosts/live",
    onMessage() {},
    reconnectMs: 1_000,
    handshakeRetryMs: 1_000,
    probe: async () => true,
    sleep: () => new Promise((resolve) => pendingSleep.push({ resolve })),
    createWebSocket() {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  });
  t.after(() => live.stop());

  sockets[0]!.open();
  sockets[0]!.drop();
  await flush();
  await flush();
  assert.equal(sockets.length, 2);
  assert.equal(sockets[1]!.readyState, 0);
  sockets[1]!.drop();
  await flush();
  assert.equal(sockets.length, 2, "CONNECTING close must wait before another socket");
  assert.equal(pendingSleep.length, 1);
});

test("stop() prevents further live sockets after close", async (t) => {
  const sockets: FakeSocket[] = [];
  const pendingSleep: Array<{ resolve: () => void }> = [];
  const live = startReconnectingWebSocket({
    url: () => "ws://127.0.0.1/api/hosts/live",
    onMessage() {},
    reconnectMs: 1_000,
    handshakeRetryMs: 1_000,
    probe: async () => true,
    sleep: () => new Promise((resolve) => pendingSleep.push({ resolve })),
    createWebSocket() {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  });

  sockets[0]!.drop();
  await flush();
  live.stop();
  pendingSleep.shift()?.resolve();
  await flush();
  await flush();
  assert.equal(sockets.length, 1);
});
