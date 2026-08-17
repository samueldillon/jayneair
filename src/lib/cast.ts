import { signal } from '@preact/signals';

// Google Cast Web Sender SDK integration. Deliberately not the Remote
// Playback API: Jayne's cast target is a Google Nest speaker, and the
// Remote Playback API only surfaces AirPlay receivers on Safari/iOS (Nest
// speakers don't speak AirPlay) and has much thinner Cast support in Chrome
// than the dedicated SDK. The real limitation is platform, not API choice:
// the Cast SDK only initializes in Chromium browsers (desktop Chrome/Edge,
// Android Chrome) — it has never shipped for iOS Safari/WebKit, so on an
// iPhone `castAvailable` simply never becomes true and the Cast button
// stays hidden. There's no web workaround for that; see CLAUDE.md.

export const castAvailable = signal(false);
export const castConnected = signal(false);
export const castDeviceName = signal<string | null>(null);
export const castPositionSec = signal(0);
export const castDurationSec = signal(0);
export const castIsPlaying = signal(false);

let initStarted = false;
let onConnectionChange: ((connected: boolean) => void) | null = null;
let positionTimer: ReturnType<typeof setInterval> | null = null;

export function setOnCastConnectionChange(cb: (connected: boolean) => void): void {
  onConnectionChange = cb;
}

export function loadCastSdk(): void {
  if (initStarted || typeof document === 'undefined') return;
  initStarted = true;

  window.__onGCastApiAvailable = (isAvailable: boolean) => {
    if (isAvailable) setUpCast();
  };

  const script = document.createElement('script');
  script.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
  script.async = true;
  document.head.appendChild(script);
}

function setUpCast(): void {
  const context = cast.framework.CastContext.getInstance();
  context.setOptions({
    receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
    autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
  });

  castAvailable.value = true;

  context.addEventListener(cast.framework.CastContextEventType.SESSION_STATE_CHANGED, (event) => {
    const connected =
      event.sessionState === cast.framework.SessionState.SESSION_STARTED ||
      event.sessionState === cast.framework.SessionState.SESSION_RESUMED;

    castConnected.value = connected;
    if (connected) {
      const session = context.getCurrentSession();
      castDeviceName.value = session?.getCastDevice()?.friendlyName ?? null;
      if (session) trackMediaSession(session);
    } else {
      castDeviceName.value = null;
      if (positionTimer) clearInterval(positionTimer);
      positionTimer = null;
    }

    onConnectionChange?.(connected);
  });
}

function trackMediaSession(session: cast.framework.CastSession): void {
  if (positionTimer) clearInterval(positionTimer);
  positionTimer = setInterval(() => {
    const media = session.getMediaSession();
    if (!media) return;
    castPositionSec.value = media.getEstimatedTime();
    castDurationSec.value = media.media?.duration ?? 0;
    castIsPlaying.value = media.playerState === chrome.cast.media.PlayerState.PLAYING;
  }, 1000);
}

function getSession(): cast.framework.CastSession | null {
  return castAvailable.value ? cast.framework.CastContext.getInstance().getCurrentSession() : null;
}

export interface CastMediaRequest {
  audioUrl: string;
  title: string;
  podcastTitle: string;
  artworkUrl: string;
  startPositionSec: number;
}

export function castLoadMedia(req: CastMediaRequest, autoplay: boolean): void {
  const session = getSession();
  if (!session) return;

  const mediaInfo = new chrome.cast.media.MediaInfo(req.audioUrl, 'audio/mpeg');
  mediaInfo.metadata = new chrome.cast.media.MusicTrackMediaMetadata();
  mediaInfo.metadata.title = req.title;
  mediaInfo.metadata.artist = req.podcastTitle;
  if (req.artworkUrl) {
    mediaInfo.metadata.images = [new chrome.cast.Image(req.artworkUrl)];
  }

  const request = new chrome.cast.media.LoadRequest(mediaInfo);
  request.currentTime = req.startPositionSec;
  request.autoplay = autoplay;

  session.loadMedia(request).then(
    () => trackMediaSession(session),
    (err) => console.error('Cast load failed', err),
  );
}

export function castPlay(): void {
  getSession()
    ?.getMediaSession()
    ?.play(
      new chrome.cast.media.PlayRequest(),
      () => {},
      () => {},
    );
}

export function castPause(): void {
  getSession()
    ?.getMediaSession()
    ?.pause(
      new chrome.cast.media.PauseRequest(),
      () => {},
      () => {},
    );
}

export function castSeek(seconds: number): void {
  const media = getSession()?.getMediaSession();
  if (!media) return;
  const req = new chrome.cast.media.SeekRequest();
  req.currentTime = seconds;
  media.seek(
    req,
    () => {},
    () => {},
  );
  castPositionSec.value = seconds;
}

export function castSkipForward30(): void {
  castSeek(castPositionSec.value + 30);
}
