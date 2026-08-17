import { signal } from '@preact/signals';
import type { Episode, Podcast } from '../types';

export const podcasts = signal<Podcast[]>([]);
export const episodesByPodcast = signal<Record<string, Episode[]>>({});
export const expandedPodcastId = signal<string | null>(null);

export const libraryLoading = signal(false);
export const libraryError = signal<string | null>(null);

export interface ToastState {
  message: string;
  onUndo?: () => void;
  id: number;
}
export const toast = signal<ToastState | null>(null);

let toastCounter = 0;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function showToast(message: string, onUndo?: () => void, durationMs = 10_000): void {
  if (toastTimer) clearTimeout(toastTimer);
  const id = ++toastCounter;
  toast.value = { message, onUndo, id };
  toastTimer = setTimeout(() => {
    if (toast.value?.id === id) toast.value = null;
  }, durationMs);
}

export function dismissToast(): void {
  if (toastTimer) clearTimeout(toastTimer);
  toast.value = null;
}
