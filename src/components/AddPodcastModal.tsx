import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { searchPodcasts } from '../lib/itunesSearch';
import { addPodcastByUrl, addPodcastFromItunes } from '../lib/podcasts';
import { podcasts } from '../lib/store';
import type { ItunesSearchResult } from '../types';

interface Props {
  uid: string;
  onClose: () => void;
}

export function AddPodcastModal({ uid, onClose }: Props) {
  const [tab, setTab] = useState<'url' | 'search'>('search');

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(10, 14, 26, 0.5)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        zIndex: 500,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: 'var(--bg)',
          width: '100%',
          maxWidth: 480,
          maxHeight: '85vh',
          overflowY: 'auto',
          borderRadius: '20px 20px 0 0',
          padding: 'var(--space-5)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-4)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: '1.3rem' }}>Add Podcast</h2>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: '1.5rem', minHeight: 'auto' }}>
            ×
          </button>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <TabButton active={tab === 'search'} onClick={() => setTab('search')}>
            Search
          </TabButton>
          <TabButton active={tab === 'url'} onClick={() => setTab('url')}>
            RSS URL
          </TabButton>
        </div>

        {tab === 'search' ? <SearchTab uid={uid} onAdded={onClose} /> : <UrlTab uid={uid} onAdded={onClose} />}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ComponentChildren }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        background: active ? 'var(--accent)' : 'transparent',
        color: active ? 'var(--accent-contrast)' : 'var(--text)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        padding: '10px',
        fontWeight: 600,
      }}
    >
      {children}
    </button>
  );
}

function UrlTab({ uid, onAdded }: { uid: string; onAdded: () => void }) {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleAdd() {
    const trimmed = url.trim();
    if (!trimmed) return;
    if (podcasts.value.some((p) => p.feedUrl === trimmed)) {
      setStatus('Already subscribed to that feed.');
      return;
    }
    setBusy(true);
    setStatus('Fetching feed…');
    try {
      await addPodcastByUrl(uid, trimmed);
      onAdded();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not add that feed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <input
        type="url"
        placeholder="https://example.com/feed.xml"
        value={url}
        onInput={(e) => setUrl((e.target as HTMLInputElement).value)}
        style={inputStyle}
      />
      <button onClick={handleAdd} disabled={busy || !url.trim()} style={primaryButtonStyle}>
        {busy ? 'Adding…' : 'Add Feed'}
      </button>
      {status && <p style={{ color: 'var(--text-dim)', margin: 0 }}>{status}</p>}
    </div>
  );
}

function SearchTab({ uid, onAdded }: { uid: string; onAdded: () => void }) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<ItunesSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function handleSearch() {
    if (!term.trim()) return;
    setSearching(true);
    setStatus(null);
    try {
      setResults(await searchPodcasts(term));
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Search failed.');
    } finally {
      setSearching(false);
    }
  }

  async function handleAdd(result: ItunesSearchResult) {
    if (!result.feedUrl) {
      setStatus('This show has no feed URL from iTunes.');
      return;
    }
    if (podcasts.value.some((p) => p.feedUrl === result.feedUrl)) {
      setStatus('Already subscribed to that show.');
      return;
    }
    setAddingId(result.collectionId);
    setStatus(null);
    try {
      await addPodcastFromItunes(uid, result.feedUrl, result.artworkUrl600 ?? result.artworkUrl100, result.collectionId);
      onAdded();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not add that show.');
    } finally {
      setAddingId(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <input
          type="text"
          placeholder="Search for a show…"
          value={term}
          onInput={(e) => setTerm((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSearch();
          }}
          style={{ ...inputStyle, flex: 1 }}
        />
        <button onClick={handleSearch} disabled={searching || !term.trim()} style={primaryButtonStyle}>
          {searching ? '…' : 'Search'}
        </button>
      </div>

      {status && <p style={{ color: 'var(--text-dim)', margin: 0 }}>{status}</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {results.map((result) => (
          <div
            key={result.collectionId}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              padding: 'var(--space-2)',
              background: 'var(--surface)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
            }}
          >
            {result.artworkUrl100 && (
              <img src={result.artworkUrl100} alt="" width={44} height={44} style={{ borderRadius: 6, flexShrink: 0 }} />
            )}
            <div style={{ flex: 1, minWidth: 0, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {result.collectionName}
            </div>
            <button onClick={() => handleAdd(result)} disabled={addingId === result.collectionId} style={smallButtonStyle}>
              {addingId === result.collectionId ? '…' : 'Add'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

const inputStyle = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  padding: '12px 14px',
  color: 'var(--text)',
  fontSize: '1rem',
  width: '100%',
};

const primaryButtonStyle = {
  background: 'var(--accent)',
  color: 'var(--accent-contrast)',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  padding: '12px 20px',
  fontWeight: 600,
};

const smallButtonStyle = {
  background: 'var(--accent)',
  color: 'var(--accent-contrast)',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  padding: '8px 16px',
  fontSize: '0.85rem',
  minHeight: 'auto',
  flexShrink: 0,
};
