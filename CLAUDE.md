# Jayne Air

A single-user "personal radio station" podcast player. Jayne subscribes to shows;
the app round-robins through them (oldest unlistened episode from each, in turn)
and plays continuously once started.

This is a clean rebuild. The previous single-file version is kept for reference
under `legacy/jayneair-v1.html` — it's not loaded by the app, but the one-time
data migration (`src/lib/migrateLegacy.ts`) reads its Firestore schema directly.

## Stack

- **Vite + TypeScript + Preact**, state via `@preact/signals`. No component
  library — every element here is hand-built and styled; the interesting parts
  of this app are the queue/listened-tracking logic and the Cast integration,
  not generic UI chrome, so a full framework's abstractions weren't worth the
  weight.
- **Firebase**: Auth (Google Sign-In), Firestore, one Cloud Function
  (`feedProxy`), Hosting. Reuses the existing `jayneair-21aa3` project.
- **Feed parsing**: native `DOMParser` on the raw XML — no feed-parser package.
- No router, no state library beyond signals, no CSS framework. Plain CSS
  custom properties carry the whole theme (`src/styles/theme.css`).

## Access control

Google Sign-In is open to any Google account, but every Firestore read/write
and every `feedProxy` call is additionally gated by an email allow-list. That
list currently exists in **three places** — keep them in sync when adding
Jayne's account:

- `firestore.rules` (`isAllowedUser`)
- `functions/src/index.ts` (`ALLOWED_EMAILS`)
- `.env` → `VITE_ALLOWED_EMAILS` (client-side UX gate only, not a security
  boundary — the two above are what actually enforce it)

There's no shared source for this list because each runs in a different
runtime (Firestore's rules language, a Cloud Function, a Vite env var) with no
natural way to share a constant across them at this scale. Three lines to edit
by hand is an acceptable tradeoff for a single-user app.

## Data model (Firestore)

```
users/{uid}/podcasts/{podcastId}
  feedUrl, title, artworkUrl, itunesId?, order (int, rotation position),
  addedAt, lastFetchedAt, episodeCount

users/{uid}/podcasts/{podcastId}/episodes/{episodeId}
  podcastId, guid, title, pubDate (ms epoch), audioUrl, durationSec,
  status: 'unlistened' | 'in_progress' | 'listened',
  positionSec, updatedAt

users/{uid}/player/state    (singleton doc)
  currentPodcastId, currentEpisodeId, queueCursorPodcastId, isPlaying, updatedAt
```

**Podcasts and episodes live in subcollections, not one array-doc.** The old
app stored everything (including embedded episodes) inside a single
`users/{uid}/data/podcasts` document. That doesn't scale to bulk-marking
500+ episodes fast: subcollections let bulk actions target exactly the docs
that changed via `writeBatch`, and avoid the 1MiB Firestore document cap that
a long-running show's embedded episode array would eventually hit.

**Doc IDs are deterministic**, not random: `podcastId = stableId(feedUrl)`,
`episodeId = stableId(\`${podcastId}:${guid}\`)` (`src/lib/hash.ts`, a cyrb53
hash — dependency-free, synchronous, good enough for a few thousand docs).
This makes refreshing a feed idempotent: re-fetching and writing to the same
IDs naturally upserts instead of duplicating, and — critically — refresh only
ever writes content fields (`title`, `audioUrl`, `durationSec`, `pubDate`) on
episodes that already exist; `status`/`positionSec` are never touched by a
refresh, so reloading a feed can never silently wipe listened state.

`player/state` intentionally does **not** duplicate playback position — each
episode's own `positionSec` is the single source of truth for resume, so
there's nothing to reconcile between the two. The player doc only exists so
reopening the app knows *which* episode to resume and where the round-robin
rotation had gotten to (`queueCursorPodcastId`).

## The queue (`src/lib/queue.ts`)

`buildQueue()` is a pure function: given the podcast list (ordered by
`order`), each podcast's episodes, a "cursor" (the podcast that just played),
and a session-local skip set, it round-robins forward from the podcast after
the cursor, picking each show's oldest not-listened episode (oldest =
earliest `pubDate` among `status !== 'listened'`) one at a time until it
either fills the requested preview length or every show runs dry. `in_progress`
episodes count as still-queued, so a partially-heard episode naturally comes
back up in its normal rotation slot rather than getting stuck or skipped.

`player.ts`'s `upcomingQueue` computed signal additionally excludes whatever
episode is currently playing — it's technically still `unlistened`/
`in_progress` in Firestore until it actually finishes, so without this
exclusion the queue preview would show the now-playing episode as its own
"up next" once the rotation cycled back around to that show.

**Skipping** (the queue panel's per-item "Skip" button) only adds the episode
to a session-local `Set` that `buildQueue` filters out — it never touches
Firestore. Reload the app and a skipped episode is back in normal rotation.
This matches the spec's "skip without marking listened": it's a temporary
reprioritization for this listening session, not a permanent status change.

## Player (`src/lib/player.ts`)

One `<audio>` element, wrapped in signals (`positionSec`, `durationSec`,
`isPlaying`, `currentEpisodeId`, etc.) that both the UI and the Cast
integration read from. `saveProgress()` (in `episodeActions.ts`) is the single
write path for playback position — called on a 5s interval while playing, on
pause, and when advancing to the next episode — and it's also where the
~95%-played → `listened` auto-mark lives (`deriveStatusFromProgress`). The
player never marks anything listened directly; it just keeps calling
`saveProgress`, and that function decides the resulting status.

**Advancing to the next episode never awaits a network write.** `advance()`
updates the local `currentPodcastId`/`currentEpisodeId` signals (and, if
autoplaying, starts local audio or Cast playback) synchronously, and only
*then* fires the outgoing episode's position save and the `player/state`
write in the background. An earlier version awaited those first, and "play
next" visibly stalled waiting on a slow/unreachable Firestore write before
switching tracks — bulk-safe writes are one thing, but a single write should
never block a supposedly-instant button.

## Chromecast (`src/lib/cast.ts`, `CastButton.tsx`)

Uses the **Google Cast Web Sender SDK**, not the Remote Playback API. The
Remote Playback API was the lighter-weight option on paper, but Jayne's
target device is a Google Nest speaker — a Cast device, not an AirPlay
receiver — and on Safari/iOS the Remote Playback API only ever surfaces
AirPlay targets. It wouldn't reach a Nest speaker from an iPhone regardless
of which API was used, so there was nothing to gain from the lighter option
here; the full SDK gives real control (play/pause/seek/status) over the
default media receiver with no custom receiver app to register.

**The honest limitation:** casting to the Nest speaker only works from
**desktop Chrome/Edge or Chrome on Android.** It will not work from an
iPhone, in Chrome or any other browser, ever — Apple requires every iOS
browser (including Chrome) to run on WebKit, and Google has never shipped
Cast support for WebKit. This is an OS policy restriction, not something
more code fixes. On iPhone, `castAvailable` simply never becomes true and
the Cast button doesn't render — verified here by pointing the app at an
unreachable `gstatic.com` (this sandbox can't reach it either), which
exercises the same "SDK never initializes" code path a real iPhone hits.
If Jayne wants both — casting to the speaker *and* using her phone — the
two have to happen from different devices: control from a laptop/Android
when she wants the Nest speaker, or listen through the phone itself
(earbuds, car Bluetooth, etc.) when she's not near a laptop.

**`<google-cast-launcher>` is created imperatively**, not as JSX. The Cast
SDK registers it as a custom element at runtime once it loads; there's no
Preact/TypeScript typing for it. An early attempt to add one via
`declare module 'preact' { namespace JSX { ... } }` accidentally shadowed
Preact's own JSX type merging and broke `children`/`HTMLAttributes` typing
across every component in the app — reverted in favor of just
`document.createElement('google-cast-launcher')` inside a `useEffect` +
`ref`, which sidesteps the whole problem.

While a Cast session is active, `player.ts` mirrors the receiver's
position/duration/playing state into the same signals the local `<audio>`
element drives (see the `effect()` wiring in `initPlayer`), so the UI,
`saveProgress`, and the 95%-listened logic all keep working unmodified
regardless of where audio is actually playing. `play`/`pause`/`skipForward30`/
`seekTo` all branch on `castConnected` to control the remote session instead
of the local element.

**Not yet verified against a real Nest speaker** — this sandbox has no route
to `gstatic.com` or any Cast device. The graceful-degrade path (SDK
unreachable → no Cast button → local playback unaffected) is verified; the
actual cast-and-control path needs a hands-on check in real desktop Chrome.

## CORS

RSS feeds don't set CORS headers for arbitrary origins, so feed XML is
fetched through `functions/src/index.ts`'s `feedProxy` Cloud Function
(fetches server-side, streams the body back with a permissive CORS header)
rather than the old app's cascade of third-party public CORS proxies
(allorigins/corsproxy.io/codetabs) — those are unreliable, rate-limited, and
route every feed URL Jayne subscribes to through strangers' servers.
`feedProxy` requires a valid Firebase ID token from an allow-listed account
(mirroring `firestore.rules`), so it can't be used as an open relay by
anyone else who finds the URL.

Podcast **audio** files need no proxy — enclosure URLs are already public by
the nature of RSS podcasting, so both the local `<audio>` element and the
Cast receiver fetch them directly.

The iTunes Search API (`itunes.apple.com/search`) already sends permissive
CORS headers and is called directly from the browser; no proxy involved.

## Bulk operations (`src/lib/episodeActions.ts`)

Every bulk action (multi-select mark, "mark this and everything older") is
optimistic-local-first: the in-memory `episodesByPodcast` signal updates
immediately (instant UI, works fine on 500+ episodes since it's a plain
`.map()` over an already-loaded array), then Firestore `writeBatch` calls
fire in the background, chunked at 450 ops/batch to stay under Firestore's
500-op batch cap. A toast with an Undo button (10s) captures a snapshot of
the affected episodes' previous statuses before applying the change and can
replay that snapshot through the same optimistic-then-batched path.

## Dev / seed mode

`src/lib/seed.ts` + the Firebase Local Emulator Suite let you exercise bulk
actions against 600+ fake episodes with zero real network/RSS calls:

```
npm run emulators                          # starts Auth + Firestore + Functions emulators
# in the app, with VITE_USE_EMULATORS=1: sign in once (any email works —
# the Auth emulator fakes the Google popup)
# grab the resulting UID from http://127.0.0.1:4000/auth
SEED_UID=<uid> npm run seed
```

## Theming

Light is the default (pink background, navy accents) regardless of OS
`prefers-color-scheme` — the spec calls for light-by-default specifically,
not "respect system," so `theme.css` deliberately has no
`@media (prefers-color-scheme)` block. Dark mode is an explicit in-app
toggle (`ThemeToggle`, `src/lib/theme.ts`) that sets `data-theme="dark"` on
`<html>` and persists to `localStorage`. All colors are CSS custom
properties on `:root`, redefined under `:root[data-theme='dark']` — every
component reads `var(--bg)`, `var(--accent)`, etc., never a literal color.

The theme toggle lives on the Library and sign-in screens only, not on the
Player screen — the player is meant to be usable at arm's length with
nothing but the transport controls competing for attention.

## Legacy migration (`src/lib/migrateLegacy.ts`)

Runs once per account, on first sign-in after this rebuild, only if the new
`podcasts` subcollection is empty but the old
`users/{uid}/data/podcasts` doc exists. The old app stored each podcast's
episodes *embedded* in that doc's `list` array (unlike what you'd guess from
a "no episode persistence" design — it does persist them, just denormalized),
plus a separate `data/history` doc (`{guid: {...}}`, listened markers only)
and a `data/resume` doc (a single in-progress episode + position — the old
app only ever tracked one in-progress episode globally, not per-episode).
Migration rebuilds the new schema directly from that already-stored data —
no feed re-fetch needed — mapping `history` entries to `listened` and the
`resume` pointer to `in_progress`. The legacy docs are left untouched
afterward as a safety net rather than deleted.

## Known gaps / what still needs a real device+network to verify

This was built and verified in a sandboxed environment with no route to
Google/Firebase/gstatic.com, so the following are implemented and
internally consistent but not yet exercised against the real internet:

- Real RSS feed fetching/parsing against actual podcast feeds (parser logic
  covers the standard RSS 2.0 + iTunes-namespace shape; verify against a
  handful of real feeds for edge cases like Atom feeds or missing fields).
- Real Google Sign-In popup flow end-to-end.
- Real audio playback/decode, scrubbing, and the ~95%-listened auto-mark
  against real episode durations.
- Real Chromecast: connecting to an actual Nest speaker, receiver playback,
  and remote control round-tripping.
- The legacy-data migration, run against the actual production
  `jayneair-21aa3` data (only verified against the old app's *schema*, read
  from `legacy/jayneair-v1.html`'s source — not against live data).

Everything else (round-robin queue math, bulk mark/unmark + undo at 600+
episodes, optimistic-update responsiveness, theme switching, tab
navigation, graceful Cast degradation) was verified in-browser via a
throwaway mock-data preview harness (not committed) driven by headless
Chromium.
