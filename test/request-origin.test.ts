import assert from "node:assert/strict";
import { test } from "node:test";
import {
  originFromRequestHeaders,
  urlOnRequestOrigin,
} from "../packages/cursor-remote-relay/lib/request-origin";

test("origin comes from Host, not a listen bind", () => {
  assert.equal(
    originFromRequestHeaders({ host: "192.168.1.10:3200" }),
    "http://192.168.1.10:3200",
  );
  assert.equal(
    urlOnRequestOrigin({ host: "127.0.0.1:3200" }, "/hosts"),
    "http://127.0.0.1:3200/hosts",
  );
});

test("origin prefers forwarded host and proto behind a reverse proxy", () => {
  assert.equal(
    originFromRequestHeaders({
      host: "127.0.0.1:3200",
      "x-forwarded-host": "relay.example",
      "x-forwarded-proto": "https",
    }),
    "https://relay.example",
  );
  assert.equal(
    urlOnRequestOrigin(
      {
        host: "10.0.0.2:3200",
        "x-forwarded-host": "relay.example, 10.0.0.2:3200",
        "x-forwarded-proto": "https, http",
      },
      "/hosts",
    ),
    "https://relay.example/hosts",
  );
});
