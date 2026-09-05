import { NextResponse } from "next/server";
import { listHosts } from "../../../../lib/hosts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ hosts: listHosts() });
}
