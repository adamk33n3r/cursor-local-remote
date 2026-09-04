export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Edge vs Nodejs runtime split: live streams and shutdown use Node APIs.
    await import("@/lib/live-ws");
    const { registerShutdownHandler } = await import("@/lib/shutdown");
    registerShutdownHandler();
  }
}
