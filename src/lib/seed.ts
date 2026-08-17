// Dev-mode seed script: populates the Firestore emulator with fake podcasts
// and episodes so bulk-marking can be exercised at 500+ episodes without
// waiting on real network/RSS calls.
//
// Usage:
//   1. firebase emulators:start (or `npm run emulators`)
//   2. Sign in once through the app running against the emulator
//      (VITE_USE_EMULATORS=1 in .env) — any email works, the Auth
//      emulator fakes the Google popup.
//   3. Grab the resulting UID from the Auth emulator UI (127.0.0.1:4000/auth)
//   4. SEED_UID=<uid> npm run seed
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const uid = process.env.SEED_UID;
if (!uid) {
  console.error('Set SEED_UID to the emulator test account UID (see Auth emulator UI at 127.0.0.1:4000/auth).');
  process.exit(1);
}

// firebase-admin auto-detects the emulator (and skips real credential
// checks) once FIRESTORE_EMULATOR_HOST is set — no service account needed.
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';

const projectId = process.env.VITE_FIREBASE_PROJECT_ID || 'jayneair-21aa3';
initializeApp({ projectId });
const db = getFirestore();

interface SeedShow {
  id: string;
  title: string;
  artworkUrl: string;
  episodeCount: number;
}

const shows: SeedShow[] = [
  { id: 'seed-show-a', title: 'Seed Show A (600 episodes)', artworkUrl: '', episodeCount: 600 },
  { id: 'seed-show-b', title: 'Seed Show B (40 episodes)', artworkUrl: '', episodeCount: 40 },
  { id: 'seed-show-c', title: 'Seed Show C (40 episodes)', artworkUrl: '', episodeCount: 40 },
];

async function seed() {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  for (const [showIndex, show] of shows.entries()) {
    const podcastRef = db.doc(`users/${uid}/podcasts/${show.id}`);
    await podcastRef.set({
      feedUrl: `https://example.invalid/${show.id}.xml`,
      title: show.title,
      artworkUrl: show.artworkUrl,
      order: showIndex,
      addedAt: now,
      lastFetchedAt: now,
      episodeCount: show.episodeCount,
    });

    let batch = db.batch();
    let opsInBatch = 0;

    for (let i = 0; i < show.episodeCount; i++) {
      const epRef = podcastRef.collection('episodes').doc(`ep-${i}`);
      batch.set(epRef, {
        podcastId: show.id,
        guid: `${show.id}-ep-${i}`,
        title: `Episode ${show.episodeCount - i}`,
        pubDate: Timestamp.fromMillis(now - i * dayMs),
        audioUrl: `https://example.invalid/${show.id}/ep-${i}.mp3`,
        durationSec: 1800,
        status: 'unlistened',
        positionSec: 0,
        updatedAt: now,
      });
      opsInBatch += 1;

      if (opsInBatch === 450) {
        await batch.commit();
        batch = db.batch();
        opsInBatch = 0;
      }
    }
    if (opsInBatch > 0) await batch.commit();

    console.log(`Seeded "${show.title}" with ${show.episodeCount} episodes.`);
  }

  console.log('Done. Sign in and refresh the library to see the seeded shows.');
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
