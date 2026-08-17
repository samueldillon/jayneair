import { useState } from 'preact/hooks';
import { episodesByPodcast, expandedPodcastId, libraryError } from '../lib/store';
import { removePodcast, refreshPodcast } from '../lib/podcasts';
import type { Podcast } from '../types';

interface Props {
  uid: string;
  podcast: Podcast;
}

export function PodcastCard({ uid, podcast }: Props) {
  const [busy, setBusy] = useState<'refresh' | 'remove' | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const episodes = episodesByPodcast.value[podcast.id] ?? [];
  const unlistenedCount = episodes.filter((e) => e.status !== 'listened').length;

  async function handleRefresh() {
    setBusy('refresh');
    try {
      await refreshPodcast(uid, podcast.id);
    } catch (err) {
      libraryError.value = err instanceof Error ? err.message : 'Refresh failed';
    } finally {
      setBusy(null);
    }
  }

  async function handleRemove() {
    if (!confirmingRemove) {
      setConfirmingRemove(true);
      return;
    }
    setBusy('remove');
    try {
      await removePodcast(uid, podcast.id);
    } catch (err) {
      libraryError.value = err instanceof Error ? err.message : 'Remove failed';
      setBusy(null);
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => (expandedPodcastId.value = podcast.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') expandedPodcastId.value = podcast.id;
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-4)',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-4)',
        cursor: 'pointer',
      }}
    >
      {podcast.artworkUrl ? (
        <img
          src={podcast.artworkUrl}
          alt=""
          width={64}
          height={64}
          style={{ borderRadius: 'var(--radius-sm)', objectFit: 'cover', flexShrink: 0 }}
        />
      ) : (
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-elevated)',
            flexShrink: 0,
          }}
        />
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {podcast.title}
        </div>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>
          {podcast.episodeCount} episode{podcast.episodeCount === 1 ? '' : 's'}
          {unlistenedCount > 0 ? ` · ${unlistenedCount} unlistened` : ' · all caught up'}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
        <button
          onClick={handleRefresh}
          disabled={busy !== null}
          aria-label={`Refresh ${podcast.title}`}
          style={iconButtonStyle}
        >
          {busy === 'refresh' ? '…' : '⟳'}
        </button>
        <button
          onClick={handleRemove}
          disabled={busy !== null}
          style={{
            ...iconButtonStyle,
            color: confirmingRemove ? 'var(--danger)' : 'inherit',
            borderColor: confirmingRemove ? 'var(--danger)' : 'var(--border)',
          }}
        >
          {busy === 'remove' ? '…' : confirmingRemove ? 'Confirm?' : 'Remove'}
        </button>
      </div>
    </div>
  );
}

const iconButtonStyle = {
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  padding: '8px 12px',
  fontSize: '0.85rem',
};
