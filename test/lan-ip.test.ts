import assert from "node:assert/strict";
import { test } from "node:test";
import { isLikelyVirtualNic, pickLanIpv4 } from "../src/lib/lan-ip";

test("isLikelyVirtualNic flags VirtualBox and Hyper-V adapters", () => {
  assert.equal(isLikelyVirtualNic("Ethernet"), false);
  assert.equal(isLikelyVirtualNic("Wi-Fi"), false);
  assert.equal(isLikelyVirtualNic("VirtualBox Host-Only Network"), true);
  assert.equal(isLikelyVirtualNic("vEthernet (WSL)"), true);
});

test("pickLanIpv4 uses the default-route address over a VirtualBox NIC listed first", () => {
  const nics = {
    "VirtualBox Host-Only Network": [
      { address: "192.168.56.1", family: "IPv4", internal: false, cidr: null, mac: "", netmask: "", scopeid: undefined },
    ],
    Ethernet: [
      { address: "192.168.1.242", family: "IPv4", internal: false, cidr: null, mac: "", netmask: "", scopeid: undefined },
    ],
  };
  assert.equal(pickLanIpv4(nics, "192.168.1.242"), "192.168.1.242");
});

test("pickLanIpv4 skips virtual NICs when no default-route IP is known", () => {
  const nics = {
    "VirtualBox Host-Only Network": [
      { address: "192.168.56.1", family: "IPv4", internal: false, cidr: null, mac: "", netmask: "", scopeid: undefined },
    ],
    "Wi-Fi": [
      { address: "192.168.1.242", family: "IPv4", internal: false, cidr: null, mac: "", netmask: "", scopeid: undefined },
    ],
  };
  assert.equal(pickLanIpv4(nics, null), "192.168.1.242");
});
