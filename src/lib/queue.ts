import type { Episode, Podcast } from '../types';

export interface QueueItem {
  podcastId: string;
  episodeId: string;
}

// Round-robin: one episode per podcast, oldest-unlistened-first per show,
// cycling through subscribed shows in `order`. Starts with the podcast
// right after `cursorPodcastId` (the one that just played) so the rotation
// keeps moving forward instead of always restarting from podcast #1.
// `skipped` excludes episodes the user skipped this session (session-only —
// skipping never marks anything listened, it just steps past it for now).
export function buildQueue(
  podcastList: Podcast[],
  episodesByPodcast: Record<string, Episode[]>,
  cursorPodcastId: string | null,
  skipped: Set<string> = new Set(),
  limit = 30,
): QueueItem[] {
  const ordered = [...podcastList].sort((a, b) => a.order - b.order);
  if (ordered.length === 0) return [];

  const startIndex = cursorPodcastId
    ? (Math.max(ordered.findIndex((p) => p.id === cursorPodcastId), -1) + 1) % ordered.length
    : 0;

  const upNextByPodcast = new Map<string, Episode[]>();
  for (const podcast of ordered) {
    const list = (episodesByPodcast[podcast.id] ?? [])
      .filter((e) => e.status !== 'listened' && !skipped.has(e.id))
      .sort((a, b) => a.pubDate - b.pubDate);
    upNextByPodcast.set(podcast.id, list);
  }

  const cursors = new Map<string, number>(ordered.map((p) => [p.id, 0]));
  const queue: QueueItem[] = [];

  while (queue.length < limit) {
    let addedThisPass = false;
    for (let i = 0; i < ordered.length && queue.length < limit; i++) {
      const podcast = ordered[(startIndex + i) % ordered.length];
      const idx = cursors.get(podcast.id)!;
      const list = upNextByPodcast.get(podcast.id)!;
      if (idx >= list.length) continue;
      queue.push({ podcastId: podcast.id, episodeId: list[idx].id });
      cursors.set(podcast.id, idx + 1);
      addedThisPass = true;
    }
    if (!addedThisPass) break;
  }

  return queue;
}
