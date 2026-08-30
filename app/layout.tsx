import type { Metadata, Viewport } from "next";
import ServiceWorkerRegistrar from "@/components/ServiceWorkerRegistrar";
import UpdateBanner from "@/components/UpdateBanner";
import "./globals.css";

export const metadata: Metadata = {
  title: "ACT map — Greenland topo",
  description:
    "Shareable Greenland topographic map links for the Arctic Circle Trail. Open #zoom/lat/lon on any phone or desktop.",
  manifest: "/manifest.webmanifest",
  applicationName: "ACT map",
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    // iPadOS reads this rather than the manifest's `display`, and without it
    // the home-screen launch still shows Safari's chrome.
    capable: true,
    title: "ACT map",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
  other: {
    // Next emits only the standardised `mobile-web-app-capable`, which Safari
    // did not honour until 17.4. The legacy spelling is what makes the Home
    // Screen launch fullscreen on an older iPad, and it costs one tag to not
    // care which iPad this ends up on.
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  // Standalone on iPad draws under the status bar; the layout pads itself back
  // out with env(safe-area-inset-*).
  viewportFit: "cover",
  themeColor: "#14171a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <ServiceWorkerRegistrar />
        <UpdateBanner />
      </body>
    </html>
  );
}
