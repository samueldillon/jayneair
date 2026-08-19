import {
  autoCastPending,
  currentEpisode,
  currentPodcast,
  durationSec,
  isPlaying,
  play,
  playNext,
  positionSec,
  seekTo,
  skipForward30,
  togglePlay,
} from '../lib/player';
import { CastButton } from './CastButton';
import { QueuePanel } from './QueuePanel';

export function Player() {
  const episode = currentEpisode.value;
  const podcast = currentPodcast.value;

  if (!episode) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: 'var(--space-4) var(--space-4) 0' }}>
          <CastButton />
        </div>
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 'var(--space-5)',
            padding: 'var(--space-6)',
            textAlign: 'center',
          }}
        >
          <h1 style={{ margin: 0, fontSize: '1.4rem', color: 'var(--text-dim)' }}>All caught up</h1>
          <button onClick={play} aria-label="Play" style={bigPlayButtonStyle}>
            <PlayIcon />
          </button>
        </div>
        <QueuePanel />
      </div>
    );
  }

  const pct = durationSec.value > 0 ? (positionSec.value / durationSec.value) * 100 : 0;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: 'var(--space-4) var(--space-4) 0' }}>
        <CastButton />
      </div>
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'var(--space-5)',
          padding: 'var(--space-6)',
        }}
      >
        {podcast?.artworkUrl ? (
          <img
            src={podcast.artworkUrl}
            alt=""
            style={{ width: 'min(70vw, 280px)', height: 'min(70vw, 280px)', borderRadius: 'var(--radius-lg)', objectFit: 'cover' }}
          />
        ) : (
          <div
            style={{
              width: 'min(70vw, 280px)',
              height: 'min(70vw, 280px)',
              borderRadius: 'var(--radius-lg)',
              background: 'var(--bg-elevated)',
            }}
          />
        )}

        <div style={{ textAlign: 'center', maxWidth: 340 }}>
          {autoCastPending.value && (
            <div style={{ color: 'var(--accent)', fontSize: '0.85rem', fontWeight: 600, marginBottom: 6 }}>
              Connecting to speaker…
            </div>
          )}
          <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{episode.title}</div>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.9rem', marginTop: 4 }}>{podcast?.title}</div>
        </div>

        <div style={{ width: '100%', maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input
            type="range"
            min={0}
            max={durationSec.value || 0}
            value={positionSec.value}
            onInput={(e) => seekTo(Number((e.target as HTMLInputElement).value))}
            aria-label="Seek"
            style={{ width: '100%', accentColor: 'var(--accent)' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
            <span>{formatTime(positionSec.value)}</span>
            <span>{formatTime(durationSec.value)}</span>
          </div>
          <div
            aria-hidden
            style={{
              height: 3,
              borderRadius: 3,
              background: 'var(--progress-track)',
              overflow: 'hidden',
              display: 'none',
            }}
          >
            <div style={{ height: '100%', width: `${pct}%`, background: 'var(--progress-fill)' }} />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-5)' }}>
          <button onClick={skipForward30} aria-label="Skip forward 30 seconds" style={secondaryControlStyle}>
            <span style={{ fontSize: '0.95rem', fontWeight: 700 }}>+30</span>
          </button>
          <button onClick={togglePlay} aria-label={isPlaying.value ? 'Pause' : 'Play'} style={bigPlayButtonStyle}>
            {isPlaying.value ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button onClick={playNext} aria-label="Play next" style={secondaryControlStyle}>
            <NextIcon />
          </button>
        </div>
      </div>

      <QueuePanel />
    </div>
  );
}

function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const bigPlayButtonStyle = {
  width: 96,
  height: 96,
  minHeight: 'auto',
  borderRadius: '50%',
  background: 'var(--accent)',
  color: 'var(--accent-contrast)',
  border: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
};

const secondaryControlStyle = {
  width: 56,
  height: 56,
  minHeight: 'auto',
  borderRadius: '50%',
  background: 'var(--surface)',
  color: 'var(--accent)',
  border: '1px solid var(--border)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

function PlayIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
    </svg>
  );
}
function NextIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 5v14l9-7zM17 5h2v14h-2z" />
    </svg>
  );
}
