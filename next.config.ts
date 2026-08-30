import type { NextConfig } from "next";

/**
 * Identity of this build, baked into the client bundle.
 *
 * Vercel's deployment id when deployed, a timestamp locally. The running page
 * compares it against /api/version to notice it is out of date.
 */
/*
 * Must be stable across a single build. Next evaluates this config more than
 * once — client compile, server compile — so anything derived from the clock
 * differs between them, and the page then reports itself out of date against
 * its own deployment. Locally it stays the literal "dev", which the banner
 * treats as "no idea" and stays quiet about.
 */
const BUILD_ID =
  process.env.VERCEL_DEPLOYMENT_ID ??
  process.env.VERCEL_URL ??
  process.env.VERCEL_GIT_COMMIT_SHA ??
  "dev";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  async headers() {
    return [
      {
        // The worker must never be served stale: a cached copy would keep
        // running old caching rules long after a deploy, and there is no way to
        // fix that from a tent.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [{ key: "Cache-Control", value: "public, max-age=3600" }],
      },
    ];
  },
};

export default nextConfig;
