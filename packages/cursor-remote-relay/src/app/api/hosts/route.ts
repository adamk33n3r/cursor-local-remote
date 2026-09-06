import { NextResponse } from "next/server";
import { listHosts } from "../../../../lib/hosts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Unreachable while listen-with-next serves GET /api/hosts from the Registration
// Map. Kept so `next start` without that gate still has a route.

export function GET() {
  return NextResponse.json({ hosts: listHosts() });
}
