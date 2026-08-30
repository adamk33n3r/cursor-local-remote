"use client";

import { useSearchParams } from "next/navigation";
import { DemoLab, StateDump } from "./debug-chrome";
import { useHostListFlow } from "./flow-state";
import { parseVariant, PrototypeSwitcher, VARIANT_NAMES, type VariantKey } from "./prototype-switcher";
import { VariantA } from "./variant-a";
import { VariantB } from "./variant-b";
import { VariantC } from "./variant-c";

function renderVariant(variant: VariantKey, flow: ReturnType<typeof useHostListFlow>) {
  switch (variant) {
    case "A":
      return <VariantA flow={flow} />;
    case "B":
      return <VariantB flow={flow} />;
    case "C":
      return <VariantC flow={flow} />;
    default: {
      const _exhaustive: never = variant;
      return _exhaustive;
    }
  }
}

export function HostListFlowPrototype() {
  const searchParams = useSearchParams();
  const variant = parseVariant(searchParams.get("variant"));
  const flow = useHostListFlow();

  return (
    <div className="flex h-[100dvh] flex-col bg-black text-text">
      <div className="shrink-0 space-y-2 border-b border-white/20 bg-[#111] p-2 pb-2">
        <p className="text-[11px] text-text-muted">
          THROW AWAY. Three variants of Login → Host list → Host, switchable via{" "}
          <code>?variant=</code>. Locked behavior from Host list tickets; this is feel, not a tunnel.
        </p>
        <p className="text-[11px] text-text-secondary">
          Now: {variant} ({VARIANT_NAMES[variant]}) · {flow.state.lastAction}
        </p>
        <DemoLab
          hosts={flow.state.hosts}
          onFlipOnline={flow.flipOnline}
          onRestore={flow.restoreDemoHosts}
          onOpenHostUrl={flow.openHostUrlLoggedOut}
        />
        <StateDump state={flow.state} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{renderVariant(variant, flow)}</div>
      <PrototypeSwitcher current={variant} />
    </div>
  );
}
