import { collection, doc, type DocumentReference, getDoc, getDocs, Timestamp, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import { stableId } from './hash';

// One-time migration from the old single-file app's schema:
//   users/{uid}/data/podcasts -> { list: [{ id, name, rssUrl, artUrl, episodes: [...], order }] }
//   users/{uid}/data/history  -> { [guid]: { podcastId, podcastName, episodeTitle, listenedAt } }
//   users/{uid}/data/resume   -> { guid, podcastId, podcastName, episodeTitle, episodeUrl, position }
// into the new per-episode subcollection model. The old app stored each
// podcast's episodes embedded in the podcast list, so this can migrate
// directly from that stored data without re-fetching any feeds — the old
// legacy/* docs are left in place afterwards, untouched, as a safety net.

interface LegacyEpisode {
  guid: string;
  url: string;
  title: string;
  pubDate: number;
}
interface LegacyPodcast {
  id: string;
  name: string;
  rssUrl: string;
  artUrl: string;
  episodes: LegacyEpisode[];
  order: number;
}
interface LegacyHistoryEntry {
  podcastId: string;
  podcastName: string;
  episodeTitle: string;
  listenedAt: number;
}
interface LegacyResume {
  guid?: string;
  position?: number;
}

export interface MigrationResult {
  migrated: boolean;
  podcastCount: number;
  episodeCount: number;
}

export async function migrateLegacyDataIfNeeded(uid: string): Promise<MigrationResult> {
  const newPodcastsSnap = await getDocs(collection(db, 'users', uid, 'podcasts'));
  if (!newPodcastsSnap.empty) return { migrated: false, podcastCount: 0, episodeCount: 0 };

  const legacyPodcastsDoc = await getDoc(doc(db, 'users', uid, 'data', 'podcasts'));
  if (!legacyPodcastsDoc.exists()) return { migrated: false, podcastCount: 0, episodeCount: 0 };

  const legacyPodcasts = (legacyPodcastsDoc.data().list ?? []) as LegacyPodcast[];
  if (legacyPodcasts.length === 0) return { migrated: false, podcastCount: 0, episodeCount: 0 };

  const [legacyHistoryDoc, legacyResumeDoc] = await Promise.all([
    getDoc(doc(db, 'users', uid, 'data', 'history')),
    getDoc(doc(db, 'users', uid, 'data', 'resume')),
  ]);
  const history = (legacyHistoryDoc.exists() ? legacyHistoryDoc.data() : {}) as Record<string, LegacyHistoryEntry>;
  const resume = (legacyResumeDoc.exists() ? legacyResumeDoc.data() : {}) as LegacyResume;

  const now = Date.now();
  const writes: { ref: DocumentReference; data: Record<string, unknown> }[] = [];
  let episodeCount = 0;

  legacyPodcasts.forEach((podcast, index) => {
    const podcastId = stableId(podcast.rssUrl);
    writes.push({
      ref: doc(db, 'users', uid, 'podcasts', podcastId),
      data: {
        feedUrl: podcast.rssUrl,
        title: podcast.name,
        artworkUrl: podcast.artUrl || '',
        order: podcast.order ?? index,
        addedAt: now,
        lastFetchedAt: null,
        episodeCount: podcast.episodes?.length ?? 0,
      },
    });

    for (const ep of podcast.episodes ?? []) {
      const epId = stableId(`${podcastId}:${ep.guid}`);
      const isResume = resume?.guid === ep.guid;
      const status = isResume ? 'in_progress' : history[ep.guid] ? 'listened' : 'unlistened';
      writes.push({
        ref: doc(db, 'users', uid, 'podcasts', podcastId, 'episodes', epId),
        data: {
          podcastId,
          guid: ep.guid,
          title: ep.title,
          pubDate: Timestamp.fromMillis(ep.pubDate || now),
          audioUrl: ep.url,
          durationSec: 0,
          status,
          positionSec: isResume ? Math.floor(resume.position || 0) : 0,
          updatedAt: now,
        },
      });
      episodeCount += 1;
    }
  });

  for (let i = 0; i < writes.length; i += 450) {
    const batch = writeBatch(db);
    for (const w of writes.slice(i, i + 450)) batch.set(w.ref, w.data);
    await batch.commit();
  }

  return { migrated: true, podcastCount: legacyPodcasts.length, episodeCount };
}
