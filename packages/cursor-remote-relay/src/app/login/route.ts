import { NextResponse } from "next/server";
import { getOnlineHost } from "../../../lib/hosts";
import { hostPickNextPath, parseHostPath } from "../../../lib/host-pick";
import {
  cookieOptions,
  LOGIN_COOKIE,
  PICK_COOKIE,
  loginCookieValue,
  loginFromEnv,
  safeEqual,
} from "../../../lib/login";
import { urlOnRequestOrigin } from "../../../lib/request-origin";

export const runtime = "nodejs";

function pathAfterLogin(nextRaw: string | null): string {
  const next = hostPickNextPath(nextRaw);
  if (!next) return "/hosts";
  const parsed = parseHostPath(next);
  if (!parsed) return "/hosts";
  if (getOnlineHost(parsed.hostId)) return next;
  return "/hosts";
}

export async function POST(req: Request) {
  const login = loginFromEnv();
  if (!login) {
    return new NextResponse("Host list is not served until Login credentials are set.\n", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const contentType = req.headers.get("content-type") ?? "";
  let username = "";
  let password = "";
  let nextRaw: string | null = null;
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(await req.text());
    username = params.get("username") ?? "";
    password = params.get("password") ?? "";
    nextRaw = params.get("next");
  } else {
    const form = await req.formData();
    username = String(form.get("username") ?? "");
    password = String(form.get("password") ?? "");
    const nextField = form.get("next");
    nextRaw = typeof nextField === "string" ? nextField : null;
  }
  if (
    !(await safeEqual(username, login.username)) ||
    !(await safeEqual(password, login.password))
  ) {
    return new NextResponse("Wrong username or password.", { status: 401 });
  }

  const res = NextResponse.redirect(urlOnRequestOrigin(req.headers, pathAfterLogin(nextRaw)), 303);
  res.cookies.set(
    LOGIN_COOKIE,
    await loginCookieValue(login.username, login.password),
    cookieOptions(),
  );
  res.cookies.set(PICK_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
  return res;
}
