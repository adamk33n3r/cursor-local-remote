import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { PwaInstall } from "@/components/pwa-install";
import { RelayChrome } from "@/components/relay-chrome";
import { VIA_RELAY_HEADER, VIA_RELAY_VALUE } from "@/lib/via-relay";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cursor Remote",
  description: "Control Cursor from any Client on your network",
  appleWebApp: {
    capable: true,
    title: "Cursor Remote",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0a0a0b",
};

const SW_CLEANUP_SCRIPT = `
if('serviceWorker' in navigator){
  navigator.serviceWorker.getRegistrations().then(function(r){
    r.forEach(function(reg){reg.unregister()})
  });
  if(typeof caches!=='undefined'){
    caches.keys().then(function(k){
      k.forEach(function(n){caches.delete(n)})
    })
  }
}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const viaRelay = (await headers()).get(VIA_RELAY_HEADER) === VIA_RELAY_VALUE;
  return (
    <html lang="en">
      <body className="overscroll-none flex h-dvh flex-col">
        <script dangerouslySetInnerHTML={{ __html: SW_CLEANUP_SCRIPT }} />
        {viaRelay ? <RelayChrome /> : null}
        <div className="min-h-0 flex-1">{children}</div>
        <PwaInstall />
      </body>
    </html>
  );
}
