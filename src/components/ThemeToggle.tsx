import { theme, toggleTheme } from '../lib/theme';

export function ThemeToggle() {
  const isDark = theme.value === 'dark';
  return (
    <button
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      style={{
        width: 40,
        height: 40,
        minHeight: 'auto',
        borderRadius: '50%',
        background: 'transparent',
        border: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        fontSize: '1.1rem',
      }}
    >
      {isDark ? '☀️' : '🌙'}
    </button>
  );
}
