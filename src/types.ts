export type EpisodeStatus = 'unlistened' | 'in_progress' | 'listened';

export interface Podcast {
  id: string;
  feedUrl: string;
  title: string;
  artworkUrl: string;
  itunesId?: number;
  order: number;
  addedAt: number;
  lastFetchedAt: number | null;
  episodeCount: number;
}

export interface Episode {
  id: string;
  podcastId: string;
  guid: string;
  title: string;
  pubDate: number;
  audioUrl: string;
  durationSec: number;
  status: EpisodeStatus;
  positionSec: number;
  updatedAt: number;
}

export type PlaybackTarget = 'local' | 'cast';

export interface PlayerState {
  currentPodcastId: string | null;
  currentEpisodeId: string | null;
  isPlaying: boolean;
  positionSec: number;
  queueCursorPodcastId: string | null;
  updatedAt: number;
}

export interface ItunesSearchResult {
  collectionId: number;
  collectionName: string;
  artworkUrl600?: string;
  artworkUrl100?: string;
  feedUrl?: string;
}
