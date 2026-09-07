import { headers } from "next/headers";
import { ChatWorkspace } from "@/components/chat-workspace";
import { ErrorBoundary } from "@/components/error-boundary";
import { VIA_RELAY_HEADER, VIA_RELAY_VALUE } from "@/lib/via-relay";

export default async function Home() {
  const viaRelay = (await headers()).get(VIA_RELAY_HEADER) === VIA_RELAY_VALUE;
  return (
    <ErrorBoundary>
      {/* After pick, Sessions starts open so this is clearly the Host, not another splash. */}
      <ChatWorkspace sidebarOpenInitially={viaRelay} />
    </ErrorBoundary>
  );
}
