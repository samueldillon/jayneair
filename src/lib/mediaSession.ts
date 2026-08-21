// Android routes hardware media keys — including a Bluetooth remote whose
// button is remapped to Play/Pause — to whichever app owns an active media
// session. Registering one here is what lets the physical clicker drive
// playback on the always-on Pixel *without reloading the page*, which is the
// whole point: the fresh-page-load path (`?autocast=1`) is exactly where the
// Cast SDK's silent ORIGIN_SCOPED auto-rejoin kept failing. Controlling an
// already-open, already-cast-connected tab sidesteps that entirely, and a
// media-key press is a real user gesture so Chrome's autoplay policy isn't
// in the way either.
//
// This module is deliberately a passive sink: it takes handlers and values
// and pushes them at the platform. `player.ts` owns all the actual playback
// logic and drives this via effects, so there's no import cycle between the
// two.

export interface MediaSessionHandlers {
  onPlay: () => void;
  onPause: () => void;
  onNext: () => void;
  onSkipForward: () => void;
  onSeekTo: (seconds: number) => void;
}

export interface MediaSessionMetadata {
  title: string;
  artist: string;
  artworkUrl: string;
}

function supported(): boolean {
  return typeof navigator !== 'undefined' && 'mediaSession' in navigator;
}

export function setMediaSessionHandlers(handlers: MediaSessionHandlers): void {
  if (!supported()) return;
  const set = (action: MediaSessionAction, cb: MediaSessionActionHandler | null) => {
    // Chrome throws on actions it doesn't implement rather than no-opping.
    try {
      navigator.mediaSession.setActionHandler(action, cb);
    } catch {
      /* action unsupported on this browser */
    }
  };

  set('play', () => handlers.onPlay());
  set('pause', () => handlers.onPause());
  set('nexttrack', () => handlers.onNext());
  set('seekforward', () => handlers.onSkipForward());
  set('seekto', (details) => {
    if (typeof details.seekTime === 'number') handlers.onSeekTo(details.seekTime);
  });
}

export function clearMediaSessionHandlers(): void {
  if (!supported()) return;
  for (const action of ['play', 'pause', 'nexttrack', 'seekforward', 'seekto'] as MediaSessionAction[]) {
    try {
      navigator.mediaSession.setActionHandler(action, null);
    } catch {
      /* ignore */
    }
  }
  navigator.mediaSession.metadata = null;
  navigator.mediaSession.playbackState = 'none';
}

export function updateMediaSessionMetadata(meta: MediaSessionMetadata | null): void {
  if (!supported()) return;
  navigator.mediaSession.metadata = meta
    ? new MediaMetadata({
        title: meta.title,
        artist: meta.artist,
        artwork: meta.artworkUrl ? [{ src: meta.artworkUrl, sizes: '512x512' }] : [],
      })
    : null;
}

export function setMediaSessionPlaybackState(state: MediaSessionPlaybackState): void {
  if (!supported()) return;
  navigator.mediaSession.playbackState = state;
}

// --- Silent keeper -------------------------------------------------------
//
// Chrome only creates (and keeps) an Android media session while the page is
// actually playing audio, and it ignores clips shorter than a few seconds
// for this purpose. While a Cast session is running the real <audio> element
// is paused on purpose, so without this the media session — and with it the
// clicker — would quietly disappear the moment casting started. A looping
// track of digital silence holds the session open at no audible cost.
//
// Generated at runtime rather than shipped as a data URI so it costs nothing
// in the bundle: 10s of 8-bit 8kHz mono silence is ~80KB of zero-fill.

const KEEPER_SECONDS = 10;

let keeperEl: HTMLAudioElement | null = null;
let keeperWanted = false;
let gestureHooked = false;

function createSilentWavUrl(seconds: number): string {
  const sampleRate = 8000;
  const numSamples = sampleRate * seconds;
  const buffer = new ArrayBuffer(44 + numSamples);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true); // byte rate (1 channel * 1 byte)
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, numSamples, true);
  // 8-bit PCM is unsigned: 128 is the zero point, not 0.
  for (let i = 0; i < numSamples; i++) view.setUint8(44 + i, 128);

  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}

function getKeeper(): HTMLAudioElement {
  if (keeperEl) return keeperEl;
  const el = new Audio(createSilentWavUrl(KEEPER_SECONDS));
  el.loop = true;
  el.preload = 'auto';
  keeperEl = el;
  return el;
}

// Before the page has seen any user interaction Chrome will refuse to start
// even silent audio. Retry once on the first tap rather than giving up — on
// the dedicated Pixel that's whoever sets it up, and from then on the
// session persists.
function retryOnFirstGesture(): void {
  if (gestureHooked || typeof document === 'undefined') return;
  gestureHooked = true;
  const onGesture = () => {
    document.removeEventListener('pointerdown', onGesture);
    gestureHooked = false;
    if (keeperWanted) getKeeper().play().catch(() => {});
  };
  document.addEventListener('pointerdown', onGesture, { once: true });
}

export function setSilentKeeperActive(active: boolean): void {
  keeperWanted = active;
  if (typeof document === 'undefined') return;
  const el = getKeeper();
  if (active) {
    if (el.paused) el.play().catch(retryOnFirstGesture);
  } else {
    el.pause();
  }
}
