import { NextResponse } from "next/server";
import { cookieOptions, LOGIN_COOKIE } from "../../../lib/login";
import { urlOnRequestOrigin } from "../../../lib/request-origin";

export const runtime = "nodejs";

export function POST(req: Request) {
  const res = NextResponse.redirect(urlOnRequestOrigin(req.headers, "/"), 303);
  res.cookies.set(LOGIN_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
  return res;
}
