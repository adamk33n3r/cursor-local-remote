import assert from "node:assert/strict";
import { test } from "node:test";
import { isLanSourceIp } from "../packages/cursor-remote-relay/lib/source-ip";

test("Registration allows loopback, RFC1918, link-local, and VPN-as-LAN source IPs", () => {
  assert.equal(isLanSourceIp("127.0.0.1"), true);
  assert.equal(isLanSourceIp("::1"), true);
  assert.equal(isLanSourceIp("::ffff:127.0.0.1"), true);
  assert.equal(isLanSourceIp("10.0.0.8"), true);
  assert.equal(isLanSourceIp("172.16.4.1"), true);
  assert.equal(isLanSourceIp("172.31.255.255"), true);
  assert.equal(isLanSourceIp("192.168.1.50"), true);
  assert.equal(isLanSourceIp("169.254.1.1"), true);
  assert.equal(isLanSourceIp("100.64.1.20"), true);
  assert.equal(isLanSourceIp("100.127.0.1"), true);
  assert.equal(isLanSourceIp("fd12:3456:789a::1"), true);
  assert.equal(isLanSourceIp("fe80::1"), true);
});

test("Registration refuses public-internet source IPs", () => {
  assert.equal(isLanSourceIp("8.8.8.8"), false);
  assert.equal(isLanSourceIp("1.1.1.1"), false);
  assert.equal(isLanSourceIp("9.9.9.9"), false);
  assert.equal(isLanSourceIp("172.15.0.1"), false);
  assert.equal(isLanSourceIp("172.32.0.1"), false);
  assert.equal(isLanSourceIp("100.63.255.255"), false);
  assert.equal(isLanSourceIp("100.128.0.1"), false);
  assert.equal(isLanSourceIp("2001:4860:4860::8888"), false);
  assert.equal(isLanSourceIp("::ffff:8.8.8.8"), false);
});
