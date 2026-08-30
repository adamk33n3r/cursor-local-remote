"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

export const VARIANT_KEYS = ["A", "B", "C"] as const;
export type VariantKey = (typeof VARIANT_KEYS)[number];

export const VARIANT_NAMES: Record<VariantKey, string> = {
  A: "Stacked pages",
  B: "Persistent Host rail",
  C: "Cards and sheets",
};

function isVariantKey(value: string): value is VariantKey {
  return (VARIANT_KEYS as readonly string[]).includes(value);
}

type PrototypeSwitcherProps = {
  current: VariantKey;
};

export function PrototypeSwitcher({ current }: PrototypeSwitcherProps) {
  const searchParams = useSearchParams();
  const hidden = process.env.NODE_ENV === "production";

  const go = (key: VariantKey) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("variant", key);
    window.location.search = next.toString();
  };

  const cycle = (dir: -1 | 1) => {
    const i = VARIANT_KEYS.indexOf(current);
    const next = VARIANT_KEYS[(i + dir + VARIANT_KEYS.length) % VARIANT_KEYS.length];
    go(next);
  };

  useEffect(() => {
    if (hidden) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        cycle(-1);
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        cycle(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, searchParams, hidden]);

  if (hidden) {
    return null;
  }

  return (
    <div className="fixed bottom-4 left-1/2 z-[80] flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/30 bg-black px-2 py-1.5 text-sm text-white shadow-[0_8px_32px_rgba(0,0,0,0.6)]">
      <button
        type="button"
        className="rounded-full px-3 py-1 hover:bg-white/10"
        aria-label="Previous variant"
        onClick={() => cycle(-1)}
      >
        ←
      </button>
      <span className="min-w-[11rem] text-center font-medium">
        {current} ({VARIANT_NAMES[current]})
      </span>
      <button
        type="button"
        className="rounded-full px-3 py-1 hover:bg-white/10"
        aria-label="Next variant"
        onClick={() => cycle(1)}
      >
        →
      </button>
    </div>
  );
}

export function parseVariant(raw: string | null): VariantKey {
  if (raw && isVariantKey(raw)) return raw;
  return "A";
}
