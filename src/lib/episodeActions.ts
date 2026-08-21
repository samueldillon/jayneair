import { doc, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import { episodesByPodcast, showToast } from './store';
import type { Episode, EpisodeStatus } from '../types';

const AUTO_LISTENED_THRESHOLD = 0.95;

export function deriveStatusFromProgress(positionSec: number, durationSec: number): EpisodeStatus {
  if (durationSec > 0 && positionSec / durationSec >= AUTO_LISTENED_THRESHOLD) return 'listened';
  if (positionSec > 0) return 'in_progress';
  return 'unlistened';
}

function episodeRef(uid: string, podcastId: string, episodeId: string) {
  return doc(db, 'users', uid, 'podcasts', podcastId, 'episodes', episodeId);
}

interface StatusChange {
  episodeId: string;
  status: EpisodeStatus;
  positionSec: number;
}

function applyLocal(podcastId: string, changes: StatusChange[]): void {
  const byId = new Map(changes.map((c) => [c.episodeId, c]));
  const current = episodesByPodcast.value[podcastId] ?? [];
  const next = current.map((ep) => {
    const change = byId.get(ep.id);
    if (!change) return ep;
    return { ...ep, status: change.status, positionSec: change.positionSec, updatedAt: Date.now() };
  });
  episodesByPodcast.value = { ...episodesByPodcast.value, [podcastId]: next };
}

// Firestore batches cap at 500 ops; chunk at 450 so a 500+ episode bulk
// action never trips the limit and each chunk commits independently.
async function commitChanges(uid: string, podcastId: string, changes: StatusChange[]): Promise<void> {
  const now = Date.now();
  for (let i = 0; i < changes.length; i += 450) {
    const batch = writeBatch(db);
    for (const change of changes.slice(i, i + 450)) {
      batch.set(
        episodeRef(uid, podcastId, change.episodeId),
        { status: change.status, positionSec: change.positionSec, updatedAt: now },
        { merge: true },
      );
    }
    await batch.commit();
  }
}

// Optimistic local update first, then background Firestore writes — bulk
// actions never block the UI, even on 500+ episode feeds. Shows a toast
// whose Undo button reverses exactly this change, both locally and remotely.
async function applyStatusChanges(uid: string, podcastId: string, changes: StatusChange[], toastMessage: string): Promise<void> {
  if (changes.length === 0) return;

  const current = episodesByPodcast.value[podcastId] ?? [];
  const byId = new Map(current.map((ep) => [ep.id, ep]));
  const previous: StatusChange[] = changes.map((c) => {
    const ep = byId.get(c.episodeId);
    return { episodeId: c.episodeId, status: ep?.status ?? 'unlistened', positionSec: ep?.positionSec ?? 0 };
  });

  applyLocal(podcastId, changes);
  commitChanges(uid, podcastId, changes).catch((err) => {
    console.error('Failed to save listened status', err);
  });

  showToast(toastMessage, () => {
    applyLocal(podcastId, previous);
    commitChanges(uid, podcastId, previous).catch((err) => {
      console.error('Failed to undo listened status', err);
    });
  });
}

export async function toggleListened(uid: string, podcastId: string, episode: Episode): Promise<void> {
  const change: StatusChange =
    episode.status === 'listened'
      ? { episodeId: episode.id, status: 'unlistened', positionSec: 0 }
      : { episodeId: episode.id, status: 'listened', positionSec: episode.positionSec || episode.durationSec || 0 };
  await applyStatusChanges(uid, podcastId, [change], change.status === 'listened' ? 'Marked as listened' : 'Marked as unlistened');
}

export async function bulkSetStatus(
  uid: string,
  podcastId: string,
  episodeIds: string[],
  status: Extract<EpisodeStatus, 'listened' | 'unlistened'>,
): Promise<void> {
  const current = episodesByPodcast.value[podcastId] ?? [];
  const byId = new Map(current.map((ep) => [ep.id, ep]));
  const changes: StatusChange[] = episodeIds.map((id) => {
    const ep = byId.get(id);
    const positionSec = status === 'unlistened' ? 0 : ep?.positionSec || ep?.durationSec || 0;
    return { episodeId: id, status, positionSec };
  });
  await applyStatusChanges(
    uid,
    podcastId,
    changes,
    `${changes.length} episode${changes.length === 1 ? '' : 's'} marked as ${status}`,
  );
}

// "Mark this and everything older as listened": everything at or before
// this episode's pubDate that isn't already listened, in one bulk change.
export async function markOlderAsListened(uid: string, podcastId: string, thresholdPubDate: number): Promise<void> {
  const current = episodesByPodcast.value[podcastId] ?? [];
  const targets = current.filter((ep) => ep.pubDate <= thresholdPubDate && ep.status !== 'listened');
  const changes: StatusChange[] = targets.map((ep) => ({
    episodeId: ep.id,
    status: 'listened',
    positionSec: ep.positionSec || ep.durationSec || 0,
  }));
  await applyStatusChanges(
    uid,
    podcastId,
    changes,
    `Marked ${changes.length} episode${changes.length === 1 ? '' : 's'} as listened`,
  );
}

// Forces an episode to 'listened' regardless of how far through it is.
// Used by the player's "play next" button: pressing Next means "I'm done
// with this one", so it shouldn't come back around in the rotation the way
// it would if we just saved its position and let the ~95% rule decide.
// Skipping an item from the *queue panel* is deliberately different — that
// stays session-local and never touches Firestore (see `skipQueueItem`).
export async function markListened(
  uid: string,
  podcastId: string,
  episode: Episode,
  positionSec?: number,
): Promise<void> {
  if (episode.status === 'listened') return;
  const change: StatusChange = {
    episodeId: episode.id,
    status: 'listened',
    positionSec: positionSec ?? episode.positionSec ?? episode.durationSec ?? 0,
  };
  await applyStatusChanges(uid, podcastId, [change], 'Marked as listened');
}

// Used by the player (next slice) on timeupdate/pause to save scrub
// position and auto-mark listened at ~95% — no toast, this isn't a
// user-initiated bulk action.
export async function saveProgress(uid: string, podcastId: string, episode: Episode, positionSec: number): Promise<void> {
  const status = deriveStatusFromProgress(positionSec, episode.durationSec);
  const change: StatusChange = { episodeId: episode.id, status, positionSec };
  applyLocal(podcastId, [change]);
  try {
    await commitChanges(uid, podcastId, [change]);
  } catch (err) {
    console.error('Failed to save playback progress', err);
  }
}
