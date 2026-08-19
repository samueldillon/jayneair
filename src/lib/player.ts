import { computed, effect, signal } from '@preact/signals';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { saveProgress } from './episodeActions';
import { buildQueue, type QueueItem } from './queue';
import { episodesByPodcast, podcasts, showToast } from './store';
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
let disposeAutoCastEffect: (() => void) | null = null;

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
      // requestAutoCast() (if any) handles its own load via a reactive
      // effect below, since it needs to wait for episode data that may not
      // have arrived from Firestore yet on a fresh page load. This branch
      // only covers a silent reconnect the user didn't explicitly ask for
      // right now (e.g. just opening the app while a session is still
      // joinable). Position comes from the episode's saved positionSec, not
      // the local positionSec signal — that signal only gets hydrated by
      // the src-loading effect below when NOT already cast-connected, which
      // a fast auto-rejoin can easily race ahead of, leaving it stuck at 0.
      if (!autoCastRequested) {
        const episode = currentEpisode.value;
        if (episode) {
          const resumeAt = Math.max(positionSec.value, episode.positionSec || 0);
          castLoadMedia(buildCastRequest(episode, resumeAt), isPlaying.value);
        }
      }
    } else {
      autoCastRequested = false;
      autoCastPending.value = false;
      disposeAutoCastEffect?.();
      disposeAutoCastEffect = null;
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
    disposeAutoCastEffect?.();
    disposeAutoCastEffect = null;
    autoCastRequested = false;
    autoCastPending.value = false;
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
//
// This waits on a reactive effect rather than checking once, because on a
// fresh page load the Cast auto-rejoin can finish *before* the episode's
// Firestore data has arrived — acting immediately in that gap previously
// meant currentEpisode.value was still null, so it fell through to
// "nothing was playing" and restarted from 0 instead of resuming. Waiting
// for player/state to have a target *and* that episode to actually be
// loaded avoids the race.
//
// A deadline flips castAutoJoinTimedOut so the effect below stops waiting
// on Cast specifically and instead falls back to local playback — it used
// to only ever act once castConnected became true, which meant a launch
// where ORIGIN_SCOPED auto-rejoin never fires at all (as opposed to firing
// late) silently did nothing: no cast, no local audio, just a paused
// screen. That's exactly what a launcher like MacroDroid/Automate hits when
// the SDK's auto-join doesn't kick in for a page opened outside Chrome's
// own navigation. The effect still waits for episode data even past the
// deadline (so it never wrongly treats "still hydrating" as "nothing was
// playing"), and still casts properly instead of falling back to local
// whenever auto-rejoin manages to connect before the deadline.
//
// 10s, not 4s: a cold page load via an external launcher has to fetch and
// initialize cast_sender.js from scratch (no warm cache the way a manual
// reopen of the tab might have) before ORIGIN_SCOPED auto-join can even
// start negotiating with the receiver, and real mobile networks make that
// slower than it looks in a warm desktop test. A too-short deadline gives
// up right as a genuine reconnect was about to land, forcing local
// playback even though Cast would have worked with a bit more patience.
// This is safe to make generous now that the wait is visible (see
// autoCastPending below) instead of a silent stall.
const castAutoJoinTimedOut = signal(false);
export const autoCastPending = signal(false);

export function requestAutoCast(): void {
  autoCastRequested = true;
  castAutoJoinTimedOut.value = false;
  autoCastPending.value = true;

  disposeAutoCastEffect?.();
  const timeoutId = setTimeout(() => {
    if (autoCastRequested) castAutoJoinTimedOut.value = true;
  }, 10000);

  disposeAutoCastEffect = effect(() => {
    if (!autoCastRequested) return;
    if (!castConnected.value && !castAutoJoinTimedOut.value) return;
    // player/state named a target episode, but its data (from a separate
    // Firestore subscription) hasn't arrived yet — wait for it rather than
    // treating this as "nothing was playing."
    if (currentEpisodeId.value && !currentEpisode.value) return;

    autoCastRequested = false;
    autoCastPending.value = false;
    clearTimeout(timeoutId);
    disposeAutoCastEffect?.();
    disposeAutoCastEffect = null;

    const episode = currentEpisode.value;
    if (castConnected.value) {
      if (episode) castLoadMedia(buildCastRequest(episode, episode.positionSec || 0), true);
      else advance(true);
      return;
    }

    // Cast never connected in time — fall back to local playback rather
    // than leaving the screen paused with nothing happening.
    if (episode) {
      const el = getAudio();
      el.src = episode.audioUrl;
      el.currentTime = episode.positionSec || 0;
      positionSec.value = episode.positionSec || 0;
      durationSec.value = episode.durationSec || 0;
      // Don't set isPlaying optimistically — the audio element's own
      // 'play'/'pause' listeners (wired in getAudio()) are the single
      // source of truth for that signal. A browser opened fresh via an
      // external launcher (MacroDroid/Automate, not a real tap in the
      // page) can have Chrome silently block this play() call under its
      // autoplay policy; setting isPlaying true regardless made the UI
      // show a Pause icon over audio that was never actually playing,
      // with no visible sign anything had gone wrong.
      el.play().catch(() => {
        showToast('Autoplay was blocked — tap play to resume.');
      });
      persistPlayerDoc().catch(() => {});
    } else {
      advance(true);
    }
  });
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
