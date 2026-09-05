import { BlockList, isIPv4, isIPv6 } from "node:net";

const lanV4 = new BlockList();
lanV4.addSubnet("10.0.0.0", 8, "ipv4");
lanV4.addSubnet("127.0.0.0", 8, "ipv4");
lanV4.addSubnet("169.254.0.0", 16, "ipv4");
lanV4.addSubnet("172.16.0.0", 12, "ipv4");
lanV4.addSubnet("192.168.0.0", 16, "ipv4");
// CGNAT / typical VPN-as-LAN (Tailscale, WireGuard, etc.)
lanV4.addSubnet("100.64.0.0", 10, "ipv4");

const lanV6 = new BlockList();
lanV6.addAddress("::1", "ipv6");
lanV6.addSubnet("fc00::", 7, "ipv6");
lanV6.addSubnet("fe80::", 10, "ipv6");

function stripZone(ip: string): string {
  const idx = ip.indexOf("%");
  return idx === -1 ? ip : ip.slice(0, idx);
}

function stripBrackets(ip: string): string {
  if (ip.startsWith("[") && ip.endsWith("]")) return ip.slice(1, -1);
  return ip;
}

function ipv4FromMapped(mapped: string): string | null {
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(mapped);
  if (dotted) return dotted[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(mapped);
  if (!hex) return null;
  const hi = Number.parseInt(hex[1], 16);
  const lo = Number.parseInt(hex[2], 16);
  return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
}

/**
 * True when a TCP source address is LAN (including VPN-as-LAN), not the public internet.
 * Used as the Registration gate: allow LAN, refuse public.
 */
export function isLanSourceIp(address: string | undefined | null): boolean {
  if (!address || typeof address !== "string") return false;
  let ip = stripZone(stripBrackets(address.trim()));
  if (!ip) return false;

  const mapped = ipv4FromMapped(ip);
  if (mapped) ip = mapped;

  if (isIPv4(ip)) return lanV4.check(ip, "ipv4");
  if (isIPv6(ip)) return lanV6.check(ip, "ipv6");
  return false;
}
