export const LOGIN_COOKIE = "cr_login";
export const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 7;

export function loginFromEnv() {
  const username = process.env.LOGIN_USERNAME ?? "";
  const password = process.env.LOGIN_PASSWORD ?? "";
  if (!username || !password) return null;
  return { username, password };
}

function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex) {
  if (hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const n = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(n)) return null;
    out[i] = n;
  }
  return out;
}

function timingSafeEqualBytes(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a[i] ^ b[i];
  }
  return out === 0;
}

async function sha256(value) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return new Uint8Array(buf);
}

export async function safeEqual(a, b) {
  const [left, right] = await Promise.all([sha256(a), sha256(b)]);
  return timingSafeEqualBytes(left, right);
}

export async function loginCookieValue(username, password) {
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

export async function isAuthedCookie(cookie, login) {
  if (!cookie) return false;
  const expected = fromHex(await loginCookieValue(login.username, login.password));
  const actual = fromHex(cookie);
  if (!expected || !actual) return false;
  return timingSafeEqualBytes(expected, actual);
}

/**
 * @returns {{ httpOnly: true, sameSite: "strict", path: "/", maxAge: number, secure: false }}
 */
export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: COOKIE_MAX_AGE_S,
    secure: false,
  };
}

export function parseCookies(header) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}
