export const LOGIN_COOKIE: "cr_login";
export const COOKIE_MAX_AGE_S: number;
export function loginFromEnv(): { username: string; password: string } | null;
export function safeEqual(a: string, b: string): Promise<boolean>;
export function loginCookieValue(username: string, password: string): Promise<string>;
export function isAuthedCookie(
  cookie: string | undefined,
  login: { username: string; password: string },
): Promise<boolean>;
export function cookieOptions(): {
  httpOnly: true;
  sameSite: "strict";
  path: "/";
  maxAge: number;
  secure: false;
};
export function parseCookies(header: string | undefined): Record<string, string>;
