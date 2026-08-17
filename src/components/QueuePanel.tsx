import { skipQueueItem, upcomingQueue } from '../lib/player';
import { episodesByPodcast, podcasts } from '../lib/store';

export function QueuePanel() {
  const queue = upcomingQueue.value;
  if (queue.length === 0) return null;

  return (
    <div
      style={{
        borderTop: '1px solid var(--border)',
        padding: 'var(--space-4) var(--space-5) var(--space-6)',
        maxHeight: '32vh',
        overflowY: 'auto',
      }}
    >
      <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: 'var(--space-2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        Up next
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {queue.map((item) => {
          const podcast = podcasts.value.find((p) => p.id === item.podcastId);
          const episode = (episodesByPodcast.value[item.podcastId] ?? []).find((e) => e.id === item.episodeId);
          if (!episode) return null;
          return (
            <div
              key={item.episodeId}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                padding: 'var(--space-2) var(--space-3)',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{episode.title}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{podcast?.title}</div>
              </div>
              <button onClick={() => skipQueueItem(item.episodeId)} style={skipButtonStyle}>
                Skip
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const skipButtonStyle = {
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  padding: '6px 12px',
  fontSize: '0.8rem',
  minHeight: 'auto',
  flexShrink: 0,
};
