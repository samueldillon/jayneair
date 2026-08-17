import {
  collection,
  deleteDoc,
  doc,
  type DocumentReference,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import { fetchFeedXml } from './feedProxy';
import { type ParsedFeed, parseFeed } from './feedParser';
import { stableId } from './hash';
import { episodesByPodcast, podcasts } from './store';
import type { Episode, Podcast } from '../types';

const episodeSubs = new Map<string, () => void>();
let podcastsSub: (() => void) | null = null;

function podcastsCol(uid: string) {
  return collection(db, 'users', uid, 'podcasts');
}
function episodesCol(uid: string, podcastId: string) {
  return collection(db, 'users', uid, 'podcasts', podcastId, 'episodes');
}

export function subscribeToLibrary(uid: string): () => void {
  unsubscribeAll();

  podcastsSub = onSnapshot(query(podcastsCol(uid), orderBy('order')), (snap) => {
    const list: Podcast[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Podcast, 'id'>) }));
    podcasts.value = list;

    const seen = new Set(list.map((p) => p.id));
    for (const podcast of list) {
      if (episodeSubs.has(podcast.id)) continue;
      const unsub = onSnapshot(query(episodesCol(uid, podcast.id), orderBy('pubDate', 'desc')), (epSnap) => {
        const eps: Episode[] = epSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Episode, 'id'>) }));
        episodesByPodcast.value = { ...episodesByPodcast.value, [podcast.id]: eps };
      });
      episodeSubs.set(podcast.id, unsub);
    }
    for (const [id, unsub] of episodeSubs) {
      if (!seen.has(id)) {
        unsub();
        episodeSubs.delete(id);
        const rest = { ...episodesByPodcast.value };
        delete rest[id];
        episodesByPodcast.value = rest;
      }
    }
  });

  return unsubscribeAll;
}

function unsubscribeAll(): void {
  podcastsSub?.();
  podcastsSub = null;
  for (const unsub of episodeSubs.values()) unsub();
  episodeSubs.clear();
  episodesByPodcast.value = {};
}

interface PendingWrite {
  ref: DocumentReference;
  data: Record<string, unknown>;
  merge?: boolean;
}

// Firestore batches cap at 500 ops; chunk at 450 to leave headroom, and to
// keep any single bulk operation from blocking on one giant commit.
async function commitInChunks(writes: PendingWrite[], chunkSize = 450): Promise<void> {
  for (let i = 0; i < writes.length; i += chunkSize) {
    const batch = writeBatch(db);
    for (const w of writes.slice(i, i + chunkSize)) {
      if (w.merge) batch.set(w.ref, w.data, { merge: true });
      else batch.set(w.ref, w.data);
    }
    await batch.commit();
  }
}

export async function addPodcastByUrl(uid: string, feedUrl: string): Promise<void> {
  const xml = await fetchFeedXml(feedUrl);
  const parsed = parseFeed(xml);
  await createPodcastFromParsed(uid, feedUrl, parsed);
}

export async function addPodcastFromItunes(
  uid: string,
  feedUrl: string,
  artworkUrl: string | undefined,
  itunesId: number,
): Promise<void> {
  const xml = await fetchFeedXml(feedUrl);
  const parsed = parseFeed(xml);
  await createPodcastFromParsed(uid, feedUrl, parsed, itunesId, artworkUrl);
}

async function createPodcastFromParsed(
  uid: string,
  feedUrl: string,
  parsed: ParsedFeed,
  itunesId?: number,
  artworkOverride?: string,
): Promise<void> {
  const podcastId = stableId(feedUrl);
  const now = Date.now();

  const writes: PendingWrite[] = [
    {
      ref: doc(db, 'users', uid, 'podcasts', podcastId),
      data: {
        feedUrl,
        title: parsed.title,
        artworkUrl: artworkOverride || parsed.artworkUrl,
        ...(itunesId ? { itunesId } : {}),
        order: podcasts.value.length,
        addedAt: now,
        lastFetchedAt: now,
        episodeCount: parsed.episodes.length,
      },
    },
  ];

  for (const ep of parsed.episodes) {
    const epId = stableId(`${podcastId}:${ep.guid}`);
    writes.push({
      ref: doc(db, 'users', uid, 'podcasts', podcastId, 'episodes', epId),
      data: {
        podcastId,
        guid: ep.guid,
        title: ep.title,
        pubDate: Timestamp.fromMillis(ep.pubDate),
        audioUrl: ep.audioUrl,
        durationSec: ep.durationSec,
        status: 'unlistened',
        positionSec: 0,
        updatedAt: now,
      },
    });
  }

  await commitInChunks(writes);
}

export async function removePodcast(uid: string, podcastId: string): Promise<void> {
  const episodesSnap = await getDocs(episodesCol(uid, podcastId));
  const writes: PendingWrite[] = episodesSnap.docs.map((d) => ({ ref: d.ref, data: {} }));
  // Deletes can't share the generic set-based chunker; do them directly.
  for (let i = 0; i < writes.length; i += 450) {
    const batch = writeBatch(db);
    for (const w of writes.slice(i, i + 450)) batch.delete(w.ref);
    await batch.commit();
  }
  await deleteDoc(doc(db, 'users', uid, 'podcasts', podcastId));
}

export async function refreshPodcast(uid: string, podcastId: string): Promise<void> {
  const podcast = podcasts.value.find((p) => p.id === podcastId);
  if (!podcast) return;

  const xml = await fetchFeedXml(podcast.feedUrl);
  const parsed = parseFeed(xml);

  const existingSnap = await getDocs(episodesCol(uid, podcastId));
  const existingByGuid = new Map<string, string>();
  existingSnap.docs.forEach((d) => existingByGuid.set((d.data() as Episode).guid, d.id));

  const now = Date.now();
  const writes: PendingWrite[] = [];

  for (const ep of parsed.episodes) {
    const existingId = existingByGuid.get(ep.guid);
    if (existingId) {
      // Only refresh content fields — status/positionSec are left untouched
      // so a reload never wipes what's already been listened to.
      writes.push({
        ref: doc(db, 'users', uid, 'podcasts', podcastId, 'episodes', existingId),
        data: {
          title: ep.title,
          audioUrl: ep.audioUrl,
          durationSec: ep.durationSec,
          pubDate: Timestamp.fromMillis(ep.pubDate),
          updatedAt: now,
        },
        merge: true,
      });
    } else {
      const epId = stableId(`${podcastId}:${ep.guid}`);
      writes.push({
        ref: doc(db, 'users', uid, 'podcasts', podcastId, 'episodes', epId),
        data: {
          podcastId,
          guid: ep.guid,
          title: ep.title,
          pubDate: Timestamp.fromMillis(ep.pubDate),
          audioUrl: ep.audioUrl,
          durationSec: ep.durationSec,
          status: 'unlistened',
          positionSec: 0,
          updatedAt: now,
        },
      });
    }
  }

  writes.push({
    ref: doc(db, 'users', uid, 'podcasts', podcastId),
    data: {
      title: parsed.title,
      artworkUrl: parsed.artworkUrl || podcast.artworkUrl,
      lastFetchedAt: now,
      episodeCount: parsed.episodes.length,
    },
    merge: true,
  });

  await commitInChunks(writes);
}

export async function refreshAllPodcasts(uid: string): Promise<void> {
  await Promise.all(
    podcasts.value.map((p) =>
      refreshPodcast(uid, p.id).catch((err) => {
        console.error(`Refresh failed for "${p.title}"`, err);
      }),
    ),
  );
}
