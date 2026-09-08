import assert from "node:assert/strict";
import { test } from "node:test";
import { PICK_COOKIE } from "../packages/cursor-remote-relay/lib/login";
import { hostPickNextPath, isCookieLessHostAsset, isHostListLivePath, isRelayOwnedPath, isStickyHostPath, resolveHostProxy } from "../packages/cursor-remote-relay/lib/host-pick";

test("Host UI root-absolute assets are sticky; Host list stays on Relay", () => {
  assert.equal(isStickyHostPath("/_next/static/css/app/page.css"), true);
  assert.equal(isStickyHostPath("/icon.png"), true);
  assert.equal(isStickyHostPath("/manifest.webmanifest"), true);
  assert.equal(isCookieLessHostAsset("/manifest.webmanifest"), true);
  assert.equal(isCookieLessHostAsset("/icon-192.png"), true);
  assert.equal(isCookieLessHostAsset("/api/info"), false);
  assert.equal(isStickyHostPath("/api/chat"), true);
  assert.equal(isRelayOwnedPath("/hosts"), true);
  assert.equal(isRelayOwnedPath("/api/hosts"), true);
  assert.equal(isRelayOwnedPath("/api/hosts/live"), true);
  assert.equal(isHostListLivePath("/api/hosts/live"), true);
  assert.equal(isHostListLivePath("/api/hosts/live/"), true);
  assert.equal(isHostListLivePath("/api/hosts"), false);
  assert.equal(isStickyHostPath("/hosts"), false);
});

test("resolveHostProxy strips /h/:id and otherwise uses the pick cookie", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assert.deepEqual(resolveHostProxy(`/h/${id}/`, "", undefined), {
    hostId: id,
    forwardUrl: "/",
    viaPrefix: true,
  });
  assert.equal(resolveHostProxy("/_next/static/css/app/page.css", "", undefined), null);
  assert.deepEqual(
    resolveHostProxy("/_next/static/css/app/page.css", "", `${PICK_COOKIE}=${id}`),
    {
      hostId: id,
      forwardUrl: "/_next/static/css/app/page.css",
      viaPrefix: false,
    },
  );
  assert.deepEqual(resolveHostProxy("/icon.png", "", `${PICK_COOKIE}=${id}`), {
    hostId: id,
    forwardUrl: "/icon.png",
    viaPrefix: false,
  });
  assert.deepEqual(resolveHostProxy("/api/info", "", `${PICK_COOKIE}=${id}`), {
    hostId: id,
    forwardUrl: "/api/info",
    viaPrefix: false,
  });
  assert.equal(resolveHostProxy("/api/hosts", "", `${PICK_COOKIE}=${id}`), null);
  assert.deepEqual(
    resolveHostProxy("/manifest.webmanifest", "", undefined, `http://127.0.0.1:3200/h/${id}/`),
    {
      hostId: id,
      forwardUrl: "/manifest.webmanifest",
      viaPrefix: false,
    },
  );
});

test("hostPickNextPath only allows a Host pick URL", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assert.equal(hostPickNextPath(`/h/${id}/`), `/h/${id}/`);
  assert.equal(hostPickNextPath(`/h/${id}`), `/h/${id}/`);
  assert.equal(hostPickNextPath(`/h/${id}/api/info`), null);
  assert.equal(hostPickNextPath("https://evil.example/h/x/"), null);
  assert.equal(hostPickNextPath("/hosts"), null);
});
