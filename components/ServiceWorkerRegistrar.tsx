"use client";

import { useEffect } from "react";

/**
 * Register the service worker.
 *
 * Nothing renders. It lives in the root layout so the worker is installed on
 * whichever page is opened first — a hut hotlink is as likely an entry point as
 * the map itself, and the offline download is useless if the worker only ever
 * installs on "/".
 */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (window.location.protocol !== "https:" && window.location.hostname !== "localhost") return;

    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
      console.error("service worker registration failed", err);
    });
  }, []);

  return null;
}
