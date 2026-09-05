export function isLikelyVirtualNic(name: string): boolean;
export function pickLanIpv4(
  nics: NodeJS.Dict<import("node:os").NetworkInterfaceInfo[]>,
  defaultRouteIp: string | null,
): string | null;
export function getDefaultRouteIpv4(): Promise<string | null>;
export function getLanIp(): Promise<string | null>;
