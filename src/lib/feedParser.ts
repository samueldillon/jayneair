export interface ParsedEpisode {
  guid: string;
  title: string;
  pubDate: number;
  audioUrl: string;
  durationSec: number;
}

export interface ParsedFeed {
  title: string;
  artworkUrl: string;
  episodes: ParsedEpisode[];
}

export function parseFeed(xmlText: string): ParsedFeed {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('Could not parse feed — not valid XML');
  }

  const channel = doc.querySelector('channel') ?? doc.documentElement;
  const title = childText(channel, 'title') || 'Untitled Podcast';
  const artworkUrl =
    channel.querySelector('image > url')?.textContent?.trim() ||
    channel.getElementsByTagNameNS('*', 'image')[0]?.getAttribute('href') ||
    '';

  const episodes: ParsedEpisode[] = [];
  for (const item of Array.from(doc.querySelectorAll('item'))) {
    const audioUrl = item.querySelector('enclosure')?.getAttribute('url') ?? '';
    if (!audioUrl) continue; // skip non-audio posts (show notes, bonus text, etc.)

    const guid = item.querySelector('guid')?.textContent?.trim() || audioUrl;
    const pubDateRaw = childText(item, 'pubDate');
    const pubDate = pubDateRaw ? Date.parse(pubDateRaw) : NaN;
    const durationRaw = item.getElementsByTagNameNS('*', 'duration')[0]?.textContent ?? '';

    episodes.push({
      guid,
      title: childText(item, 'title') || 'Untitled Episode',
      pubDate: Number.isFinite(pubDate) ? pubDate : Date.now(),
      audioUrl,
      durationSec: parseDuration(durationRaw),
    });
  }

  episodes.sort((a, b) => b.pubDate - a.pubDate);
  return { title, artworkUrl, episodes };
}

function childText(el: Element, tag: string): string {
  return el.querySelector(tag)?.textContent?.trim() ?? '';
}

function parseDuration(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  const parts = trimmed.split(':').map(Number);
  if (parts.some(Number.isNaN)) return 0;
  return parts.reduce((acc, part) => acc * 60 + part, 0);
}
