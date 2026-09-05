import { getWebhookUrl, sendWebhook } from "@/lib/webhooks";
import { badRequest, serverError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const url = await getWebhookUrl();
    if (!url) {
      return badRequest("No webhook URL configured");
    }

    await sendWebhook(url, {
      event: "test",
      title: "Cursor Remote",
      message: "Test notification -- webhook is working!",
      timestamp: Date.now(),
    });

    return Response.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to send test notification";
    return serverError(msg);
  }
}
