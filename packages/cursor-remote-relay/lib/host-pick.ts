import { PICK_COOKIE, parseCookies } from "./login";

export type HostProxyTarget = {
  hostId: string;
  forwardUrl: string;
  viaPrefix: boolean;
};

export function parseHostPath(pathname: string): { hostId: string; rest: string } | null {
  const match = /^\/h\/([^/]+)(\/.*)?$/.exec(pathname);
  if (!match) return null;
  const rest = match[2] && match[2].length > 0 ? match[2] : "/";
  return { hostId: decodeURIComponent(match[1]), rest };
}

/** Login `next` may only be a Host pick URL (`/h/:id/`), never an open redirect. */
export function hostPickNextPath(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  const pathname = value.split("?")[0] ?? "";
  const parsed = parseHostPath(pathname);
  if (!parsed || parsed.rest !== "/") return null;
  return `/h/${encodeURIComponent(parsed.hostId)}/`;
}

export function isRelayOwnedPath(pathname: string): boolean {
  if (
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/logout" ||
    pathname === "/hosts"
  ) {
    return true;
  }
  return pathname === "/api/hosts" || pathname.startsWith("/api/hosts/");
}

/**
 * Root-absolute Host app URLs the browser requests after opening /h/:id/.
 * Next emits /_next and /api at the origin, not under the pick prefix.
 */
export function isStickyHostPath(pathname: string): boolean {
  if (pathname.startsWith("/_next/") || pathname.startsWith("/api/")) return true;
  return /^\/[^/]+\.(png|ico|svg|webp|json|webmanifest|js)$/i.test(pathname);
}

export function resolveHostProxy(
  pathname: string,
  search: string,
  cookieHeader: string | undefined,
): HostProxyTarget | null {
  const prefixed = parseHostPath(pathname);
  if (prefixed) {
    return {
      hostId: prefixed.hostId,
      forwardUrl: `${prefixed.rest}${search}`,
      viaPrefix: true,
    };
  }
  if (isRelayOwnedPath(pathname) || !isStickyHostPath(pathname)) return null;
  const pick = parseCookies(cookieHeader)[PICK_COOKIE];
  if (!pick) return null;
  return {
    hostId: decodeURIComponent(pick),
    forwardUrl: `${pathname}${search}`,
    viaPrefix: false,
  };
}
