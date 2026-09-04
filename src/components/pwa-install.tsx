"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";

export function PwaInstall() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    apiFetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        if (data.settings?.pwa_prompt !== false) setEnabled(true);
      })
      .catch(() => setEnabled(true));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    import("@khmyznikov/pwa-install").catch(() => {});
  }, [enabled]);

  if (!enabled) return null;

  return (
    <pwa-install
      manifest-url="/manifest.webmanifest"
      name="Cursor Remote"
      description="Control Cursor from any Client on your network"
      icon="/apple-touch-icon.png"
    />
  );
}
