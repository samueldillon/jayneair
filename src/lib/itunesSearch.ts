import type { ItunesSearchResult } from '../types';

export async function searchPodcasts(term: string): Promise<ItunesSearchResult[]> {
  const trimmed = term.trim();
  if (!trimmed) return [];
  const url = `https://itunes.apple.com/search?media=podcast&entity=podcast&limit=25&term=${encodeURIComponent(trimmed)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`iTunes search failed (${res.status})`);
  const data = (await res.json()) as { results?: ItunesSearchResult[] };
  return data.results ?? [];
}
