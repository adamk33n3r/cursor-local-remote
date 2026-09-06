import { createSocket } from "node:dgram";
import { networkInterfaces } from "node:os";

const VIRTUAL_NIC_RE =
  /virtualbox|vmware|vbox|hyper-v|vethernet|wsl|docker|loopback|bluetooth|pseudo|hamachi|zerotier|radmin|npcap|tap-windows|qemu|hyperv/i;

type NicAddr = { address: string; family: string | number; internal: boolean };
type LanCandidate = { name: string; address: string; virtual: boolean };

/**
 * Virtual adapters (VirtualBox Host-Only, Hyper-V, etc.) often appear first in
 * os.networkInterfaces() and are not the LAN the phone is on.
 */
export function isLikelyVirtualNic(name: string): boolean {
  return VIRTUAL_NIC_RE.test(name);
}

function isIpv4(addr: NicAddr): boolean {
  return addr.family === "IPv4" || addr.family === 4;
}

function isUsableLan(addr: NicAddr): boolean {
  return isIpv4(addr) && !addr.internal && !addr.address.startsWith("169.254.");
}

function collectCandidates(nics: NodeJS.Dict<NicAddr[]>): LanCandidate[] {
  const out: LanCandidate[] = [];
  for (const [name, addrs] of Object.entries(nics)) {
    if (!addrs) continue;
    const virtual = isLikelyVirtualNic(name);
    for (const addr of addrs) {
      if (isUsableLan(addr)) out.push({ name, address: addr.address, virtual });
    }
  }
  return out;
}

/**
 * Prefer the OS default-route source address when it belongs to a local NIC.
 * Otherwise skip virtual NICs, then any remaining IPv4.
 */
export function pickLanIpv4(
  nics: NodeJS.Dict<NicAddr[]>,
  defaultRouteIp: string | null,
): string | null {
  const candidates = collectCandidates(nics);
  if (defaultRouteIp) {
    const match = candidates.find((c) => c.address === defaultRouteIp);
    if (match) return match.address;
  }
  const real = candidates.find((c) => !c.virtual);
  if (real) return real.address;
  return candidates[0]?.address ?? null;
}

/**
 * UDP connect uses the routing table without sending a packet, so the bound
 * address is the NIC that would reach the internet (has a default gateway).
 */
export function getDefaultRouteIpv4(): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = createSocket("udp4");
    const finish = (ip: string | null) => {
      try {
        socket.close();
      } catch {
        /* already closed */
      }
      resolve(ip);
    };
    const timer = setTimeout(() => finish(null), 500);
    socket.once("error", () => {
      clearTimeout(timer);
      finish(null);
    });
    socket.connect(53, "8.8.8.8", () => {
      clearTimeout(timer);
      try {
        const ip = socket.address().address;
        finish(typeof ip === "string" && ip !== "0.0.0.0" ? ip : null);
      } catch {
        finish(null);
      }
    });
  });
}

export async function getLanIp(): Promise<string | null> {
  const nics = networkInterfaces();
  const defaultRouteIp = await getDefaultRouteIpv4();
  return pickLanIpv4(nics, defaultRouteIp);
}
