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

/** rel=manifest (and its icons) are fetched without cookies. APIs and JS are not. */
export function isCookieLessHostAsset(pathname: string): boolean {
  return /^\/[^/]+\.(png|ico|svg|webp|webmanifest)$/i.test(pathname);
}

function hostIdFromReferer(referer: string | undefined): string | null {
  if (!referer) return null;
  try {
    const parsed = parseHostPath(new URL(referer).pathname);
    return parsed?.hostId ?? null;
  } catch {
    return null;
  }
}

export function resolveHostProxy(
  pathname: string,
  search: string,
  cookieHeader: string | undefined,
  referer?: string,
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
  // rel=manifest is fetched without cookies; the document URL is still /h/:id/.
  const hostId = pick ? decodeURIComponent(pick) : hostIdFromReferer(referer);
  if (!hostId) return null;
  return {
    hostId,
    forwardUrl: `${pathname}${search}`,
    viaPrefix: false,
  };
}
