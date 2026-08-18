// Fetches a feed URL through the standalone Cloudflare Worker in
// cloudflare-worker/ (deployed separately — see its README/CLAUDE.md's CORS
// section for setup), which solves the browser CORS problem by fetching
// server-side. Replaces both the original feedProxy Cloud Function (needs
// Firebase's paid Blaze plan) and a brief stint using public third-party
// CORS proxies, which proved unreliable in real testing.
const FEED_PROXY_URL = import.meta.env.VITE_FEED_PROXY_URL;

export async function fetchFeedXml(feedUrl: string): Promise<string> {
  if (!FEED_PROXY_URL) {
    throw new Error('VITE_FEED_PROXY_URL is not set — see cloudflare-worker/ and CLAUDE.md');
  }

  const res = await fetch(`${FEED_PROXY_URL}?url=${encodeURIComponent(feedUrl)}`);
  if (!res.ok) {
    throw new Error(`Could not fetch feed (${res.status}): ${await res.text()}`);
  }
  return res.text();
}
