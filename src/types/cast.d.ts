// Minimal ambient declarations for the Google Cast Web Sender SDK — just
// the pieces this app actually uses. Written by hand instead of pulling in
// @types/chromecast-caf-sender to keep dependencies down; the SDK itself is
// loaded at runtime via a <script> tag, never bundled.

declare namespace cast.framework {
  enum SessionState {
    SESSION_STARTED = 'SESSION_STARTED',
    SESSION_RESUMED = 'SESSION_RESUMED',
    SESSION_ENDED = 'SESSION_ENDED',
  }

  enum CastContextEventType {
    SESSION_STATE_CHANGED = 'sessionstatechanged',
  }

  interface CastDevice {
    friendlyName: string;
  }

  interface CastSession {
    getCastDevice(): CastDevice | null;
    getMediaSession(): chrome.cast.media.Media | null;
    loadMedia(request: chrome.cast.media.LoadRequest): Promise<void>;
  }

  interface SessionStateEventData {
    sessionState: SessionState;
  }

  interface CastOptions {
    receiverApplicationId: string;
    autoJoinPolicy: string;
  }

  class CastContext {
    static getInstance(): CastContext;
    setOptions(options: CastOptions): void;
    getCurrentSession(): CastSession | null;
    addEventListener(type: CastContextEventType, handler: (event: SessionStateEventData) => void): void;
  }
}

declare namespace chrome.cast {
  const AutoJoinPolicy: { ORIGIN_SCOPED: string };

  class Image {
    constructor(url: string);
  }

  namespace media {
    const DEFAULT_MEDIA_RECEIVER_APP_ID: string;

    enum PlayerState {
      PLAYING = 'PLAYING',
      PAUSED = 'PAUSED',
      IDLE = 'IDLE',
      BUFFERING = 'BUFFERING',
    }

    class MusicTrackMediaMetadata {
      title?: string;
      artist?: string;
      images?: Image[];
    }

    class MediaInfo {
      constructor(contentId: string, contentType: string);
      metadata?: MusicTrackMediaMetadata;
    }

    class LoadRequest {
      constructor(mediaInfo: MediaInfo);
      currentTime?: number;
      autoplay?: boolean;
    }

    class PlayRequest {}
    class PauseRequest {}
    class SeekRequest {
      currentTime?: number;
    }

    interface MediaInfoLike {
      duration: number | null;
    }

    class Media {
      media: MediaInfoLike;
      playerState: PlayerState;
      getEstimatedTime(): number;
      play(request: PlayRequest, success: () => void, error: (err: unknown) => void): void;
      pause(request: PauseRequest, success: () => void, error: (err: unknown) => void): void;
      seek(request: SeekRequest, success: () => void, error: (err: unknown) => void): void;
    }
  }
}

interface Window {
  __onGCastApiAvailable?: (isAvailable: boolean) => void;
}
