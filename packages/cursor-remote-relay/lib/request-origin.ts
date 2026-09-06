function firstHeader(
  headers: Headers | NodeJS.Dict<string | string[] | undefined>,
  name: string,
): string | undefined {
  if (headers instanceof Headers) {
    const value = headers.get(name);
    return value?.split(",")[0]?.trim() || undefined;
  }
  const raw = headers[name] ?? headers[name.toLowerCase()];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.split(",")[0]?.trim() || undefined;
}

/**
 * Public origin the Client used: Host, or X-Forwarded-Host / X-Forwarded-Proto
 * when a reverse proxy sits in front. Never the listen bind address.
 */
export function originFromRequestHeaders(
  headers: Headers | NodeJS.Dict<string | string[] | undefined>,
): string | null {
  const host = firstHeader(headers, "x-forwarded-host") ?? firstHeader(headers, "host");
  if (!host) return null;
  const proto = firstHeader(headers, "x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

export function urlOnRequestOrigin(
  headers: Headers | NodeJS.Dict<string | string[] | undefined>,
  path: string,
): string {
  const origin = originFromRequestHeaders(headers);
  if (!origin) return path;
  return new URL(path, origin).toString();
}
