import { NextResponse } from "next/server";
import {
  cookieOptions,
  LOGIN_COOKIE,
  loginCookieValue,
  loginFromEnv,
  safeEqual,
} from "../../../lib/login.mjs";

export const runtime = "nodejs";

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
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(await req.text());
    username = params.get("username") ?? "";
    password = params.get("password") ?? "";
  } else {
    const form = await req.formData();
    username = String(form.get("username") ?? "");
    password = String(form.get("password") ?? "");
  }
  if (
    !(await safeEqual(username, login.username)) ||
    !(await safeEqual(password, login.password))
  ) {
    return new NextResponse("Wrong username or password.", { status: 401 });
  }

  const res = NextResponse.redirect(new URL("/hosts", req.url), 303);
  res.cookies.set(
    LOGIN_COOKIE,
    await loginCookieValue(login.username, login.password),
    cookieOptions(),
  );
  return res;
}
