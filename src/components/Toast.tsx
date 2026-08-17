import { dismissToast, toast } from '../lib/store';

export function Toast() {
  const state = toast.value;
  if (!state) return null;

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 76px)',
        transform: 'translateX(-50%)',
        background: 'var(--accent)',
        color: 'var(--accent-contrast)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-3) var(--space-4)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
        zIndex: 1000,
        width: 'min(360px, calc(100vw - 32px))',
      }}
    >
      <span style={{ flex: 1, fontSize: '0.9rem' }}>{state.message}</span>
      {state.onUndo && (
        <button
          onClick={() => {
            state.onUndo?.();
            dismissToast();
          }}
          style={{
            background: 'transparent',
            border: '1px solid currentColor',
            borderRadius: 'var(--radius-sm)',
            padding: '6px 14px',
            color: 'inherit',
            fontWeight: 600,
            minHeight: 'auto',
            flexShrink: 0,
          }}
        >
          Undo
        </button>
      )}
      <button
        onClick={dismissToast}
        aria-label="Dismiss"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'inherit',
          opacity: 0.7,
          minHeight: 'auto',
          fontSize: '1.1rem',
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}
