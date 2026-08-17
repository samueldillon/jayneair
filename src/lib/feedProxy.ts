import { auth } from './firebase';

const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID;
const USE_EMULATORS = import.meta.env.VITE_USE_EMULATORS === '1';

function functionsBaseUrl(): string {
  return USE_EMULATORS
    ? `http://127.0.0.1:5001/${PROJECT_ID}/us-central1`
    : `https://us-central1-${PROJECT_ID}.cloudfunctions.net`;
}

// Fetches a feed URL through the feedProxy Cloud Function, which solves the
// browser CORS problem by fetching server-side. Requires the caller to be
// signed in — the function checks the ID token against its own allow-list.
export async function fetchFeedXml(feedUrl: string): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in before adding a podcast');
  const idToken = await user.getIdToken();

  const res = await fetch(`${functionsBaseUrl()}/feedProxy?url=${encodeURIComponent(feedUrl)}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!res.ok) {
    throw new Error(`Could not fetch feed (${res.status}): ${await res.text()}`);
  }
  return res.text();
}
