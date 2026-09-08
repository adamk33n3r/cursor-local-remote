import { NextResponse } from "next/server";
import { forgetHost } from "../../../../../../lib/hosts";
import { clearPickCookieHeader, PICK_COOKIE, parseCookies } from "../../../../../../lib/login";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Unreachable while listen-with-next serves POST /api/hosts/:id/forget from
// the Registration Map. Kept so `next start` without that gate still has a route.

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const result = forgetHost(id);
  if (result === "online") {
    return new NextResponse("Forget is only for offline Hosts.\n", { status: 409 });
  }
  if (result === "missing") {
    return new NextResponse("Host is not on the Host list.\n", { status: 404 });
  }
  const res = new NextResponse(null, { status: 204 });
  const pick = parseCookies(req.headers.get("cookie") ?? undefined)[PICK_COOKIE];
  if (pick && decodeURIComponent(pick) === id) {
    res.headers.append("Set-Cookie", clearPickCookieHeader());
  }
  return res;
}
