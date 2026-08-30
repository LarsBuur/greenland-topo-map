"use client";

import dynamic from "next/dynamic";

// Leaflet touches `window` at import time, so it must never be server-rendered.
const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => <div className="act-loading">Loading map…</div>,
});

export default function MapLoader() {
  return <MapView />;
}
