import { signal } from '@preact/signals';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { ALLOWED_EMAILS, auth, googleProvider } from './firebase';

export const currentUser = signal<User | null>(null);
export const authReady = signal(false);
export const authError = signal<string | null>(null);

onAuthStateChanged(auth, (user) => {
  currentUser.value = user;
  authReady.value = true;
});

// Google Sign-In stays open to any Google account; the real access control
// is this allow-list check plus the matching Firestore/Cloud Function rules.
// This client-side check is only a UX gate — someone outside the list who
// signs in still can't read or write any data.
export function isAllowed(user: User | null): boolean {
  const email = user?.email?.toLowerCase();
  return !!email && ALLOWED_EMAILS.includes(email);
}

export async function signIn(): Promise<void> {
  authError.value = null;
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (err) {
    authError.value = err instanceof Error ? err.message : 'Sign-in failed';
  }
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}
