import { NextResponse } from "next/server";
import { cookieOptions, LOGIN_COOKIE } from "../../../lib/login.mjs";

export const runtime = "nodejs";

export function POST(req: Request) {
  const res = NextResponse.redirect(new URL("/", req.url), 303);
  res.cookies.set(LOGIN_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
  return res;
}
