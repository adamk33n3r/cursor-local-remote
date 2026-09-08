import { NextResponse } from "next/server";
import { forgetHost, forgetHttp } from "../../../../../../lib/hosts";
import { clearPickCookieHeader, PICK_COOKIE, parseCookies } from "../../../../../../lib/login";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Unreachable while listen-with-next serves POST /api/hosts/:id/forget from
// the in-process Host list. Kept so `next start` without that gate still has a route.

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const outcome = forgetHttp(forgetHost(id));
  if (outcome.status !== 204) {
    return new NextResponse(outcome.body, { status: outcome.status });
  }
  const res = new NextResponse(null, { status: 204 });
  const pick = parseCookies(req.headers.get("cookie") ?? undefined)[PICK_COOKIE];
  if (pick && decodeURIComponent(pick) === id) {
    res.headers.append("Set-Cookie", clearPickCookieHeader());
  }
  return res;
}
