import { signal } from '@preact/signals';

type Theme = 'light' | 'dark';

const STORAGE_KEY = 'jayneair-theme';

function readStored(): Theme {
  if (typeof localStorage === 'undefined') return 'light';
  return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
}

export const theme = signal<Theme>(readStored());

function applyTheme(value: Theme): void {
  document.documentElement.setAttribute('data-theme', value);
}

applyTheme(theme.value);

export function toggleTheme(): void {
  theme.value = theme.value === 'light' ? 'dark' : 'light';
  applyTheme(theme.value);
  localStorage.setItem(STORAGE_KEY, theme.value);
}
