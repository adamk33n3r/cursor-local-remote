import { listCursorCacheWorkspaces } from "@/lib/transcript-reader";
import { listWorkspaces } from "@/lib/session-store";
import { getWorkspace } from "@/lib/workspace";
import { serverError } from "@/lib/errors";
import { mergeKnownWorkspaces } from "@/lib/merge-known-workspaces.mjs";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [fromCursorCache, fromSessionStore] = await Promise.all([
      listCursorCacheWorkspaces(),
      listWorkspaces(),
    ]);
    const startDirectory = getWorkspace();
    return Response.json(
      mergeKnownWorkspaces({
        fromCursorCache,
        fromSessionStore,
        startDirectory,
      }),
    );
  } catch {
    return serverError("Failed to list workspaces");
  }
}
