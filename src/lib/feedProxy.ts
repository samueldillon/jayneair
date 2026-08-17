// STOPGAP: fetches feeds through public third-party CORS proxies instead of
// the feedProxy Cloud Function in functions/src/index.ts. That function
// needs the Blaze (pay-as-you-go) plan — Cloud Functions on the free Spark
// plan can't make outbound requests to non-Google domains at all — and this
// deploy is staying on Spark for now. This is exactly the kind of
// third-party-proxy-cascade approach CLAUDE.md's CORS section originally
// argued against (unreliable, rate-limited, routes every feed URL through
// someone else's server) — worth switching back to feedProxy.ts's Cloud
// Function once Blaze (or a Cloudflare Workers alternative) is set up;
// see git history for the previous implementation.
interface ProxyDef {
  build: (url: string) => string;
}

const PROXIES: ProxyDef[] = [
  { build: (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}` },
  { build: (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}` },
  { build: (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}` },
];

export async function fetchFeedXml(feedUrl: string): Promise<string> {
  let lastError: Error | null = null;

  for (const proxy of PROXIES) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(proxy.build(feedUrl), { signal: controller.signal });
      if (!res.ok) throw new Error(`Proxy returned ${res.status}`);
      const text = await res.text();
      if (!text.trim()) throw new Error('Empty response');
      return text;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`Could not fetch feed — all proxies failed (${lastError?.message ?? 'unknown error'})`);
}
