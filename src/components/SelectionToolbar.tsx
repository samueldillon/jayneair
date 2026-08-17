interface Props {
  total: number;
  selectedCount: number;
  onSelectAll: () => void;
  onClear: () => void;
  onMarkListened: () => void;
  onMarkUnlistened: () => void;
}

export function SelectionToolbar({ total, selectedCount, onSelectAll, onClear, onMarkListened, onMarkUnlistened }: Props) {
  const allSelected = total > 0 && selectedCount === total;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
        padding: 'var(--space-3) var(--space-5)',
        background: 'var(--bg-elevated)',
        borderBottom: '1px solid var(--border)',
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <button onClick={allSelected ? onClear : onSelectAll} style={chipStyle}>
          {allSelected ? 'Clear all' : 'Select all'}
        </button>
        <span style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>{selectedCount} selected</span>
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <button onClick={onMarkListened} disabled={selectedCount === 0} style={{ ...primaryChipStyle, flex: '1 1 auto' }}>
          Mark as listened
        </button>
        <button onClick={onMarkUnlistened} disabled={selectedCount === 0} style={{ ...chipStyle, flex: '1 1 auto' }}>
          Mark as unlistened
        </button>
      </div>
    </div>
  );
}

const chipStyle = {
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  padding: '10px 14px',
  fontSize: '0.85rem',
  minHeight: 'auto',
  whiteSpace: 'nowrap',
} as const;

const primaryChipStyle = {
  ...chipStyle,
  background: 'var(--accent)',
  color: 'var(--accent-contrast)',
  border: 'none',
};
