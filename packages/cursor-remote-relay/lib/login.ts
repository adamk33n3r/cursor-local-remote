export const LOGIN_COOKIE = "cr_login";
export const PICK_COOKIE = "cr_pick";
export const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 7;

export type LoginCredentials = { username: string; password: string };

export function loginFromEnv(): LoginCredentials | null {
  const username = process.env.LOGIN_USERNAME ?? "";
  const password = process.env.LOGIN_PASSWORD ?? "";
  if (!username || !password) return null;
  return { username, password };
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const n = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(n)) return null;
    out[i] = n;
  }
  return out;
}

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a[i] ^ b[i];
  }
  return out === 0;
}

async function sha256(value: string): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return new Uint8Array(buf);
}

export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([sha256(a), sha256(b)]);
  return timingSafeEqualBytes(left, right);
}

export async function loginCookieValue(username: string, password: string): Promise<string> {
  // HMAC of the username, keyed by the password, so the cookie is not the Login
  // password and still validates after a Relay restart with the same credentials.
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`cursor-remote-relay:${username}`),
  );
  return toHex(new Uint8Array(sig));
}

export async function isAuthedCookie(
  cookie: string | undefined,
  login: LoginCredentials,
): Promise<boolean> {
  if (!cookie) return false;
  const expected = fromHex(await loginCookieValue(login.username, login.password));
  const actual = fromHex(cookie);
  if (!expected || !actual) return false;
  return timingSafeEqualBytes(expected, actual);
}

export function cookieOptions(): {
  httpOnly: true;
  sameSite: "strict";
  path: "/";
  maxAge: number;
  secure: false;
} {
  return {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: COOKIE_MAX_AGE_S,
    secure: false,
  };
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

export function pickCookieHeader(hostId: string): string {
  return `${PICK_COOKIE}=${encodeURIComponent(hostId)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE_S}`;
}

export function clearPickCookieHeader(): string {
  return `${PICK_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}
