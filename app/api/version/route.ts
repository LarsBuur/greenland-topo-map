/**
 * What build this deployment is.
 *
 * A Home Screen web app on iOS does not reload when you switch back to it — it
 * resumes the suspended page. So a deploy can sit on the server for days while
 * the phone keeps running the JavaScript it started with, and the app looks
 * like it never got the change. Comparing this against the build baked into the
 * running bundle is how the page finds out.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return new Response(JSON.stringify({ build: process.env.NEXT_PUBLIC_BUILD_ID ?? "dev" }), {
    headers: {
      "content-type": "application/json",
      // Never cached anywhere: a cached answer would report the old build for
      // as long as it lived, which defeats the entire point.
      "cache-control": "no-store, no-cache, must-revalidate",
    },
  });
}
