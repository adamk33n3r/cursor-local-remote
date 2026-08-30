import { Suspense } from "react";
import { HostListFlowPrototype } from "./host-list-flow-prototype";

// Three variants of Login → Host list → Host, switchable via ?variant=, on throwaway route /prototype/host-list-flow.
export default function HostListFlowPrototypePage() {
  return (
    <Suspense fallback={<div className="p-8 text-text-muted">Loading prototype…</div>}>
      <HostListFlowPrototype />
    </Suspense>
  );
}
