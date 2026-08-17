import { computed, effect, signal } from '@preact/signals';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { saveProgress } from './episodeActions';
import { buildQueue, type QueueItem } from './queue';
import { episodesByPodcast, podcasts } from './store';
import type { Episode } from '../types';

export const currentPodcastId = signal<string | null>(null);
export const currentEpisodeId = signal<string | null>(null);
export const isPlaying = signal(false);
export const positionSec = signal(0);
export const durationSec = signal(0);
export const queueCursorPodcastId = signal<string | null>(null);
export const skippedEpisodeIds = signal<Set<string>>(new Set());

export const currentEpisode = computed<Episode | null>(() => {
  const pid = currentPodcastId.value;
  const eid = currentEpisodeId.value;
  if (!pid || !eid) return null;
  return (episodesByPodcast.value[pid] ?? []).find((e) => e.id === eid) ?? null;
});

export const currentPodcast = computed(() => podcasts.value.find((p) => p.id === currentPodcastId.value) ?? null);

export const upcomingQueue = computed<QueueItem[]>(() => {
  // Exclude whatever's currently playing — it's still "unlistened" in
  // Firestore terms until it finishes, but it shouldn't show up as its own
  // "up next" once it's already the one on screen.
  const exclude = new Set(skippedEpisodeIds.value);
  if (currentEpisodeId.value) exclude.add(currentEpisodeId.value);
  return buildQueue(podcasts.value, episodesByPodcast.value, queueCursorPodcastId.value, exclude);
});

let audioEl: HTMLAudioElement | null = null;
let uid: string | null = null;
let saveTimer: ReturnType<typeof setInterval> | null = null;
let playerDocUnsub: (() => void) | null = null;
let disposeSrcEffect: (() => void) | null = null;
let hydrated = false;

function getAudio(): HTMLAudioElement {
  if (audioEl) return audioEl;
  const el = new Audio();
  el.preload = 'metadata';
  el.addEventListener('timeupdate', () => {
    positionSec.value = el.currentTime;
    if (Number.isFinite(el.duration)) durationSec.value = el.duration;
  });
  el.addEventListener('play', () => (isPlaying.value = true));
  el.addEventListener('pause', () => (isPlaying.value = false));
  el.addEventListener('ended', () => {
    advance(true);
  });
  audioEl = el;
  return el;
}

// Wires the player to a signed-in user: hydrates the last-playing episode
// from Firestore (once — after that local state wins so we don't fight our
// own writes), keeps the audio element's src in sync with currentEpisode,
// and periodically saves playback position. Returns a cleanup function.
export function initPlayer(userId: string): () => void {
  uid = userId;
  hydrated = false;

  playerDocUnsub?.();
  playerDocUnsub = onSnapshot(doc(db, 'users', userId, 'player', 'state'), (snap) => {
    if (hydrated || !snap.exists()) return;
    hydrated = true;
    const data = snap.data() as {
      currentPodcastId?: string;
      currentEpisodeId?: string;
      queueCursorPodcastId?: string;
    };
    if (data.currentPodcastId && data.currentEpisodeId) {
      currentPodcastId.value = data.currentPodcastId;
      currentEpisodeId.value = data.currentEpisodeId;
    }
    queueCursorPodcastId.value = data.queueCursorPodcastId ?? null;
  });

  if (saveTimer) clearInterval(saveTimer);
  saveTimer = setInterval(persistPosition, 5000);

  disposeSrcEffect?.();
  disposeSrcEffect = effect(() => {
    const episode = currentEpisode.value;
    const el = getAudio();
    if (!episode) {
      el.pause();
      el.removeAttribute('src');
      return;
    }
    if (el.src !== episode.audioUrl) {
      el.src = episode.audioUrl;
      el.currentTime = episode.positionSec || 0;
      positionSec.value = episode.positionSec || 0;
      durationSec.value = episode.durationSec || 0;
    }
  });

  return () => {
    playerDocUnsub?.();
    playerDocUnsub = null;
    if (saveTimer) clearInterval(saveTimer);
    saveTimer = null;
    disposeSrcEffect?.();
    disposeSrcEffect = null;
  };
}

async function persistPlayerDoc(): Promise<void> {
  if (!uid) return;
  await setDoc(
    doc(db, 'users', uid, 'player', 'state'),
    {
      currentPodcastId: currentPodcastId.value,
      currentEpisodeId: currentEpisodeId.value,
      queueCursorPodcastId: queueCursorPodcastId.value,
      isPlaying: isPlaying.value,
      updatedAt: Date.now(),
    },
    { merge: true },
  );
}

function persistPosition(): void {
  if (!uid || !isPlaying.value) return;
  const episode = currentEpisode.value;
  const podcastId = currentPodcastId.value;
  if (!episode || !podcastId) return;
  saveProgress(uid, podcastId, episode, Math.floor(positionSec.value)).catch(() => {});
}

// Local state (and, if autoplay, the audio element) switch to the next
// episode immediately — saving the outgoing episode's position and writing
// the player/state doc happen in the background and must never gate the
// transition, or a slow connection would make "play next" feel stuck.
function advance(autoplay: boolean): void {
  if (!uid) return;

  const leavingEpisode = currentEpisode.value;
  const leavingPodcastId = currentPodcastId.value;
  if (leavingEpisode && leavingPodcastId) {
    saveProgress(uid, leavingPodcastId, leavingEpisode, Math.floor(positionSec.value)).catch(() => {});
  }

  const next = upcomingQueue.value[0];
  if (!next) {
    currentPodcastId.value = null;
    currentEpisodeId.value = null;
    getAudio().pause();
    persistPlayerDoc().catch(() => {});
    return;
  }

  currentPodcastId.value = next.podcastId;
  currentEpisodeId.value = next.episodeId;
  queueCursorPodcastId.value = next.podcastId;
  persistPlayerDoc().catch(() => {});

  if (autoplay) {
    queueMicrotask(() => {
      getAudio()
        .play()
        .catch(() => {});
    });
  }
}

export function play(): void {
  if (!currentEpisodeId.value) {
    advance(true);
    return;
  }
  getAudio()
    .play()
    .catch(() => {});
  persistPlayerDoc().catch(() => {});
}

export function pause(): void {
  getAudio().pause();
  persistPlayerDoc().catch(() => {});
  if (uid && currentEpisode.value && currentPodcastId.value) {
    saveProgress(uid, currentPodcastId.value, currentEpisode.value, Math.floor(positionSec.value)).catch(() => {});
  }
}

export function togglePlay(): void {
  if (isPlaying.value) pause();
  else play();
}

// Used by both the "play next" button and the queue's per-item skip — jumps
// straight to the next queued episode. Whatever was playing keeps whatever
// listened status its saved position already implies (skipping never forces
// a status change).
export function playNext(): void {
  advance(true);
}

export function skipForward30(): void {
  const el = getAudio();
  el.currentTime = Number.isFinite(el.duration) ? Math.min(el.duration, el.currentTime + 30) : el.currentTime + 30;
}

export function seekTo(seconds: number): void {
  getAudio().currentTime = seconds;
  positionSec.value = seconds;
}

// Steps a specific *upcoming* (not currently playing) episode out of the
// queue preview for this session only — it stays unlistened in Firestore
// and reappears once the app is reloaded.
export function skipQueueItem(episodeId: string): void {
  skippedEpisodeIds.value = new Set(skippedEpisodeIds.value).add(episodeId);
}
