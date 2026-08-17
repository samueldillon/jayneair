import { activeTab, expandedPodcastId } from '../lib/store';

export function TabBar() {
  if (expandedPodcastId.value) return null;

  return (
    <nav
      style={{
        display: 'flex',
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-elevated)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      <TabButton label="Player" active={activeTab.value === 'player'} onClick={() => (activeTab.value = 'player')} />
      <TabButton label="Library" active={activeTab.value === 'library'} onClick={() => (activeTab.value = 'library')} />
    </nav>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        background: 'transparent',
        border: 'none',
        borderTop: active ? '2px solid var(--accent)' : '2px solid transparent',
        color: active ? 'var(--accent)' : 'var(--text-dim)',
        padding: '12px 0',
        fontWeight: active ? 700 : 500,
        fontSize: '0.9rem',
      }}
    >
      {label}
    </button>
  );
}
