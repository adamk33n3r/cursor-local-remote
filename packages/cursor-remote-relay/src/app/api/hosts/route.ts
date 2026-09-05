import { NextResponse } from "next/server";

export const runtime = "nodejs";

export function GET() {
  // Registration is a later ticket; v1 Login still shows this empty list.
  return NextResponse.json({ hosts: [] });
}
