import { getNetworkInfo } from "@/lib/network";
import { getWorkspace } from "@/lib/workspace";
import { DEFAULT_PORT } from "@/lib/constants";

export const dynamic = "force-dynamic";

export async function GET() {
  const info = await getNetworkInfo(parseInt(process.env.PORT || String(DEFAULT_PORT), 10));
  const token = process.env.AUTH_TOKEN;
  const authUrl = token ? `${info.url}?token=${token}` : info.url;
  return Response.json({ ...info, authUrl, workspace: getWorkspace() });
}
