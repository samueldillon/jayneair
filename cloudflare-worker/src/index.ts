// Proxies RSS feed fetches so the browser doesn't hit CORS errors.
// Replaces functions/src/index.ts's feedProxy Cloud Function (which needs
// Firebase's paid Blaze plan) and the third-party proxy cascade that briefly
// stood in for it in src/lib/feedProxy.ts — that cascade proved unreliable
// in real testing (two of three proxies timed out, the third 403'd).
//
// Deliberately left open, with no auth check: Cloudflare Workers don't have
// the Firebase Admin SDK available to verify ID tokens the way the original
// Cloud Function did, and this matches the same open-access posture the
// third-party proxies it replaces already had. Worth adding real auth back
// (e.g. a shared secret, or full Firebase JWT verification) if this ever
// gets abused as an open relay — for a single-user app it hasn't been worth
// the extra complexity yet.

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
    }

    const feedUrl = new URL(request.url).searchParams.get('url');
    if (!feedUrl) {
      return new Response('Missing url query param', { status: 400, headers: CORS_HEADERS });
    }

    let target: URL;
    try {
      target = new URL(feedUrl);
    } catch {
      return new Response('Invalid url', { status: 400, headers: CORS_HEADERS });
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      return new Response('Only http(s) URLs are allowed', { status: 400, headers: CORS_HEADERS });
    }

    try {
      const upstream = await fetch(target.toString(), {
        headers: { 'User-Agent': 'JayneAir/1.0 (+podcast feed reader)' },
        redirect: 'follow',
      });
      if (!upstream.ok) {
        return new Response(`Upstream returned ${upstream.status}`, { status: 502, headers: CORS_HEADERS });
      }
      const body = await upstream.text();
      return new Response(body, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': upstream.headers.get('content-type') ?? 'application/xml; charset=utf-8',
        },
      });
    } catch (err) {
      return new Response(`Fetch failed: ${(err as Error).message}`, { status: 502, headers: CORS_HEADERS });
    }
  },
};
