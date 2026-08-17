import { useState } from 'preact/hooks';
import { bulkSetStatus, markOlderAsListened, toggleListened } from '../lib/episodeActions';
import { episodesByPodcast, expandedPodcastId, podcasts } from '../lib/store';
import type { Episode } from '../types';
import { SelectionToolbar } from './SelectionToolbar';

interface Props {
  uid: string;
  podcastId: string;
}

export function EpisodeList({ uid, podcastId }: Props) {
  const episodes = episodesByPodcast.value[podcastId] ?? [];
  const podcast = podcasts.value.find((p) => p.id === podcastId);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelectionMode() {
    setSelectionMode(false);
    setSelected(new Set());
  }

  async function handleBulk(status: 'listened' | 'unlistened') {
    const ids = [...selected];
    if (ids.length === 0) return;
    exitSelectionMode();
    await bulkSetStatus(uid, podcastId, ids, status);
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          padding: 'var(--space-4) var(--space-5)',
        }}
      >
        <button onClick={() => (expandedPodcastId.value = null)} aria-label="Back to library" style={iconButtonStyle}>
          ←
        </button>
        <h1
          style={{
            margin: 0,
            fontSize: '1.2rem',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {podcast?.title ?? 'Episodes'}
        </h1>
        <button onClick={() => (selectionMode ? exitSelectionMode() : setSelectionMode(true))} style={secondaryButtonStyle}>
          {selectionMode ? 'Cancel' : 'Select'}
        </button>
      </div>

      {selectionMode && (
        <SelectionToolbar
          total={episodes.length}
          selectedCount={selected.size}
          onSelectAll={() => setSelected(new Set(episodes.map((e) => e.id)))}
          onClear={() => setSelected(new Set())}
          onMarkListened={() => handleBulk('listened')}
          onMarkUnlistened={() => handleBulk('unlistened')}
        />
      )}

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 'var(--space-3) var(--space-5) var(--space-7)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
        }}
      >
        {episodes.length === 0 && <p style={{ color: 'var(--text-dim)' }}>No episodes yet — try refreshing this show.</p>}
        {episodes.map((episode) => (
          <EpisodeRow
            key={episode.id}
            episode={episode}
            selectionMode={selectionMode}
            selected={selected.has(episode.id)}
            onToggleSelected={() => toggleSelected(episode.id)}
            onToggleListened={() => toggleListened(uid, podcastId, episode)}
            onMarkOlder={() => markOlderAsListened(uid, podcastId, episode.pubDate)}
          />
        ))}
      </div>
    </div>
  );
}

interface RowProps {
  episode: Episode;
  selectionMode: boolean;
  selected: boolean;
  onToggleSelected: () => void;
  onToggleListened: () => void;
  onMarkOlder: () => void;
}

function EpisodeRow({ episode, selectionMode, selected, onToggleSelected, onToggleListened, onMarkOlder }: RowProps) {
  return (
    <div
      onClick={selectionMode ? onToggleSelected : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-3)',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        opacity: episode.status === 'listened' && !selectionMode ? 0.6 : 1,
        cursor: selectionMode ? 'pointer' : 'default',
      }}
    >
      {selectionMode ? (
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelected}
          onClick={(e) => e.stopPropagation()}
          style={{ width: 22, height: 22, flexShrink: 0, minHeight: 'auto' }}
        />
      ) : (
        <button
          onClick={onToggleListened}
          aria-label={episode.status === 'listened' ? 'Mark as unlistened' : 'Mark as listened'}
          style={statusButtonStyle(episode.status)}
        >
          {episode.status === 'listened' ? '✓' : episode.status === 'in_progress' ? '◐' : ''}
        </button>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{episode.title}</div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>{formatDate(episode.pubDate)}</div>
      </div>

      {!selectionMode && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onMarkOlder();
          }}
          style={smallLinkStyle}
        >
          Mark older
        </button>
      )}
    </div>
  );
}

function formatDate(ms: number): string {
  if (!ms) return '';
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function statusButtonStyle(status: Episode['status']) {
  return {
    width: 32,
    height: 32,
    minHeight: 'auto',
    borderRadius: '50%',
    border: '2px solid var(--accent)',
    background: status === 'listened' ? 'var(--accent)' : 'transparent',
    color: status === 'listened' ? 'var(--accent-contrast)' : 'var(--accent)',
    flexShrink: 0,
    fontSize: '0.9rem',
    padding: 0,
  };
}

const iconButtonStyle = {
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  width: 40,
  height: 40,
  minHeight: 'auto',
  flexShrink: 0,
};

const secondaryButtonStyle = {
  background: 'transparent',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  padding: '8px 16px',
  fontSize: '0.9rem',
  minHeight: 'auto',
};

const smallLinkStyle = {
  background: 'transparent',
  border: 'none',
  color: 'var(--text-dim)',
  fontSize: '0.75rem',
  textDecoration: 'underline',
  minHeight: 'auto',
  flexShrink: 0,
};
