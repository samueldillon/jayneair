import { useState } from 'preact/hooks';
import { refreshAllPodcasts } from '../lib/podcasts';
import { expandedPodcastId, libraryError, podcasts } from '../lib/store';
import { AddPodcastModal } from './AddPodcastModal';
import { EpisodeList } from './EpisodeList';
import { PodcastCard } from './PodcastCard';
import { ThemeToggle } from './ThemeToggle';

interface Props {
  uid: string;
}

export function Library({ uid }: Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const list = podcasts.value;
  const expandedId = expandedPodcastId.value;

  async function handleRefreshAll() {
    setRefreshing(true);
    try {
      await refreshAllPodcasts(uid);
    } finally {
      setRefreshing(false);
    }
  }

  if (expandedId) {
    return <EpisodeList uid={uid} podcastId={expandedId} />;
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 'var(--space-5)', gap: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem' }}>Jayne Air</h1>
        <ThemeToggle />
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        {list.length > 0 && (
          <button onClick={handleRefreshAll} disabled={refreshing} style={secondaryButtonStyle}>
            {refreshing ? 'Refreshing…' : 'Refresh all'}
          </button>
        )}
        <button onClick={() => setModalOpen(true)} style={primaryButtonStyle}>
          + Add Podcast
        </button>
      </div>

      {libraryError.value && (
        <p style={{ color: 'var(--danger)', margin: 0 }}>{libraryError.value}</p>
      )}

      {list.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: 'var(--text-dim)' }}>
          <div>
            <p>No podcasts yet.</p>
            <button onClick={() => setModalOpen(true)} style={primaryButtonStyle}>
              Add your first show
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {list.map((podcast) => (
            <PodcastCard key={podcast.id} uid={uid} podcast={podcast} />
          ))}
        </div>
      )}

      {modalOpen && <AddPodcastModal uid={uid} onClose={() => setModalOpen(false)} />}
    </div>
  );
}

const primaryButtonStyle = {
  background: 'var(--accent)',
  color: 'var(--accent-contrast)',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  padding: '10px 18px',
  fontWeight: 600,
  fontSize: '0.9rem',
};

const secondaryButtonStyle = {
  background: 'transparent',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  padding: '10px 18px',
  fontSize: '0.9rem',
};
