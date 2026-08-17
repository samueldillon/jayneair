import { computed, effect, signal } from '@preact/signals';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { saveProgress } from './episodeActions';
import { buildQueue, type QueueItem } from './queue';
import { episodesByPodcast, podcasts } from './store';
import {
  castConnected,
  castDurationSec,
  castIsPlaying,
  castLoadMedia,
  castPause,
  castPlay,
  castPositionSec,
  castSeek,
  castSkipForward30,
  loadCastSdk,
  setOnCastConnectionChange,
} from './cast';
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
let disposeCastMirrorEffect: (() => void) | null = null;
let hydrated = false;
let autoCastRequested = false;

function getAudio(): HTMLAudioElement {
  if (audioEl) return audioEl;
  const el = new Audio();
  el.preload = 'metadata';
  el.addEventListener('timeupdate', () => {
    if (castConnected.value) return;
    positionSec.value = el.currentTime;
    if (Number.isFinite(el.duration)) durationSec.value = el.duration;
  });
  el.addEventListener('play', () => {
    if (!castConnected.value) isPlaying.value = true;
  });
  el.addEventListener('pause', () => {
    if (!castConnected.value) isPlaying.value = false;
  });
  el.addEventListener('ended', () => {
    if (!castConnected.value) advance(true);
  });
  audioEl = el;
  return el;
}

function buildCastRequest(episode: Episode, startPositionSec: number) {
  const podcast = podcasts.value.find((p) => p.id === episode.podcastId);
  return {
    audioUrl: episode.audioUrl,
    title: episode.title,
    podcastTitle: podcast?.title ?? '',
    artworkUrl: podcast?.artworkUrl ?? '',
    startPositionSec,
  };
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

  // Loads the current episode into whichever <audio> element is active —
  // skipped while casting, since the Cast receiver is playing it instead
  // and downloading it locally too would just waste bandwidth.
  disposeSrcEffect?.();
  disposeSrcEffect = effect(() => {
    const episode = currentEpisode.value;
    const el = getAudio();
    if (!episode || castConnected.value) {
      el.pause();
      return;
    }
    if (el.src !== episode.audioUrl) {
      el.src = episode.audioUrl;
      el.currentTime = episode.positionSec || 0;
      positionSec.value = episode.positionSec || 0;
      durationSec.value = episode.durationSec || 0;
    }
  });

  // Mirrors Cast receiver state into the same positionSec/durationSec/
  // isPlaying signals the local <audio> element drives, so the UI, the
  // ~95%-listened logic, and persistPosition() all work unmodified
  // regardless of where audio is actually playing.
  disposeCastMirrorEffect?.();
  disposeCastMirrorEffect = effect(() => {
    if (!castConnected.value) return;
    isPlaying.value = castIsPlaying.value;
    positionSec.value = castPositionSec.value;
    durationSec.value = castDurationSec.value || currentEpisode.value?.durationSec || 0;
  });

  loadCastSdk();
  setOnCastConnectionChange((connected) => {
    if (connected) {
      getAudio().pause();
      if (autoCastRequested) {
        // A one-tap "play on the speaker" trigger (e.g. a home-screen
        // shortcut) — force playback to start even if nothing was already
        // playing in this browser tab, falling back to the front of the
        // queue if there's no in-progress episode to resume.
        autoCastRequested = false;
        const episode = currentEpisode.value;
        if (episode) castLoadMedia(buildCastRequest(episode, episode.positionSec || 0), true);
        else advance(true);
        return;
      }
      const episode = currentEpisode.value;
      if (episode) castLoadMedia(buildCastRequest(episode, positionSec.value), isPlaying.value);
    } else {
      autoCastRequested = false;
      const episode = currentEpisode.value;
      if (episode) {
        // Handing playback back to the phone/laptop at wherever the
        // receiver left off.
        const el = getAudio();
        el.src = episode.audioUrl;
        el.currentTime = positionSec.value;
        if (isPlaying.value) el.play().catch(() => {});
      }
    }
  });

  return () => {
    playerDocUnsub?.();
    playerDocUnsub = null;
    if (saveTimer) clearInterval(saveTimer);
    saveTimer = null;
    disposeSrcEffect?.();
    disposeSrcEffect = null;
    disposeCastMirrorEffect?.();
    disposeCastMirrorEffect = null;
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

  const nextEpisode = currentEpisode.value;
  if (castConnected.value) {
    if (nextEpisode) castLoadMedia(buildCastRequest(nextEpisode, nextEpisode.positionSec || 0), autoplay);
  } else if (autoplay) {
    queueMicrotask(() => {
      getAudio()
        .play()
        .catch(() => {});
    });
  }
}

// One-tap "play on the speaker" entry point for a home-screen shortcut,
// widget, or physical-button automation: opens the app straight to a
// working cast session with no manual Cast-icon tap needed. Relies on the
// Cast SDK's ORIGIN_SCOPED auto-join — once a session has been started from
// this browser/device once, later page loads silently rejoin it — so the
// very first use still needs one manual tap to pick the Nest speaker, but
// every use after that is a single open-the-URL action.
export function requestAutoCast(): void {
  autoCastRequested = true;
  if (castConnected.value) {
    autoCastRequested = false;
    const episode = currentEpisode.value;
    if (episode) castLoadMedia(buildCastRequest(episode, episode.positionSec || 0), true);
    else advance(true);
  }
}

export function play(): void {
  if (!currentEpisodeId.value) {
    advance(true);
    return;
  }
  if (castConnected.value) {
    castPlay();
  } else {
    getAudio()
      .play()
      .catch(() => {});
  }
  persistPlayerDoc().catch(() => {});
}

export function pause(): void {
  if (castConnected.value) castPause();
  else getAudio().pause();
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
  if (castConnected.value) {
    castSkipForward30();
    return;
  }
  const el = getAudio();
  el.currentTime = Number.isFinite(el.duration) ? Math.min(el.duration, el.currentTime + 30) : el.currentTime + 30;
}

export function seekTo(seconds: number): void {
  if (castConnected.value) {
    castSeek(seconds);
    return;
  }
  getAudio().currentTime = seconds;
  positionSec.value = seconds;
}

// Steps a specific *upcoming* (not currently playing) episode out of the
// queue preview for this session only — it stays unlistened in Firestore
// and reappears once the app is reloaded.
export function skipQueueItem(episodeId: string): void {
  skippedEpisodeIds.value = new Set(skippedEpisodeIds.value).add(episodeId);
}
