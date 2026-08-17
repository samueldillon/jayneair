import { onRequest } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

initializeApp();

const ALLOWED_EMAILS = ['samueldillon@gmail.com'];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

// Proxies RSS feed fetches so the browser doesn't hit CORS errors, and so
// Jayne's feed list isn't routed through a third-party proxy service.
// Requires a valid Firebase ID token from an allow-listed account, mirroring
// firestore.rules, so this can't be used as an open SSRF relay by the public.
export const feedProxy = onRequest({ cors: false }, async (req, res) => {
  for (const [key, value] of Object.entries(CORS_HEADERS)) res.set(key, value);

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).send('Method not allowed');
    return;
  }

  const authHeader = req.get('Authorization') ?? '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) {
    res.status(401).send('Missing Authorization header');
    return;
  }

  try {
    const decoded = await getAuth().verifyIdToken(idToken);
    const email = decoded.email?.toLowerCase();
    if (!email || !ALLOWED_EMAILS.includes(email)) {
      res.status(403).send('Forbidden');
      return;
    }
  } catch {
    res.status(401).send('Invalid token');
    return;
  }

  const rawUrl = req.query.url;
  if (typeof rawUrl !== 'string') {
    res.status(400).send('Missing url query param');
    return;
  }

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    res.status(400).send('Invalid url');
    return;
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    res.status(400).send('Only http(s) URLs are allowed');
    return;
  }

  try {
    const upstream = await fetch(target.toString(), {
      headers: { 'User-Agent': 'JayneAir/1.0 (+podcast feed reader)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    if (!upstream.ok) {
      res.status(502).send(`Upstream returned ${upstream.status}`);
      return;
    }
    const body = await upstream.text();
    res.set('Content-Type', upstream.headers.get('content-type') ?? 'application/xml; charset=utf-8');
    res.status(200).send(body);
  } catch (err) {
    res.status(502).send(`Fetch failed: ${(err as Error).message}`);
  }
});
