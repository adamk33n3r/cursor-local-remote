import { getLanIp } from "./lan-ip";

export async function getNetworkInfo(port: number = 3100) {
  const lanIp = await getLanIp();
  return {
    lanIp: lanIp || "localhost",
    port,
    url: lanIp ? `http://${lanIp}:${port}` : `http://localhost:${port}`,
  };
}

export { getDefaultRouteIpv4, getLanIp, isLikelyVirtualNic, pickLanIpv4 } from "./lan-ip";
