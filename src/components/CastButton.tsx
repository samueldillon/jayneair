import { useEffect, useRef } from 'preact/hooks';
import { castAvailable, castConnected, castDeviceName } from '../lib/cast';

// <google-cast-launcher> is a custom element the Cast SDK itself registers
// once it initializes; it already hides itself when no Cast device is on
// the network and handles the connect/disconnect click. It's created
// imperatively (rather than as JSX) since it's a runtime-registered custom
// element with no Preact/TS typings to lean on.
function GoogleCastLauncher() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = document.createElement('google-cast-launcher');
    el.style.width = '32px';
    el.style.height = '32px';
    el.style.display = 'inline-block';
    el.style.setProperty('--connected-color', 'var(--accent)');
    el.style.setProperty('--disconnected-color', 'var(--text-dim)');
    containerRef.current?.appendChild(el);
    return () => {
      el.remove();
    };
  }, []);

  return <div ref={containerRef} style={{ display: 'inline-flex' }} />;
}

// Only gated on castAvailable — on iOS Safari/Chrome (or any non-Chromium
// browser) the Cast SDK never initializes, castAvailable stays false, and
// this renders nothing at all, which is the graceful degrade the spec
// asked for.
export function CastButton() {
  if (!castAvailable.value) return null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
      {castConnected.value && castDeviceName.value && (
        <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{castDeviceName.value}</span>
      )}
      <GoogleCastLauncher />
    </div>
  );
}
