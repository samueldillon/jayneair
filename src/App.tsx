import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { authReady, currentUser, isAllowed } from './lib/auth';
import { migrateLegacyDataIfNeeded } from './lib/migrateLegacy';
import { initPlayer, requestAutoCast } from './lib/player';
import { subscribeToLibrary } from './lib/podcasts';
import { activeTab, showToast } from './lib/store';
import { Library } from './components/Library';
import { Player } from './components/Player';
import { SignInScreen } from './components/SignInScreen';
import { TabBar } from './components/TabBar';
import { Toast } from './components/Toast';

export function App() {
  const ready = authReady.value;
  const user = currentUser.value;
  const [libraryReady, setLibraryReady] = useState(false);

  useEffect(() => {
    if (!user || !isAllowed(user)) {
      setLibraryReady(false);
      return;
    }

    let cancelled = false;
    setLibraryReady(false);

    (async () => {
      try {
        const result = await migrateLegacyDataIfNeeded(user.uid);
        if (cancelled) return;
        if (result.migrated) {
          showToast(`Migrated ${result.podcastCount} podcast${result.podcastCount === 1 ? '' : 's'} from the old app.`);
        }
      } catch (err) {
        console.error('Legacy migration failed', err);
      }
      if (cancelled) return;
      setLibraryReady(true);
    })();

    const unsubscribeLibrary = subscribeToLibrary(user.uid);
    const disposePlayer = initPlayer(user.uid);

    // One-tap "play on the speaker" entry point for a home-screen shortcut
    // or physical-button automation: https://<app>/?autocast=1
    if (new URLSearchParams(location.search).get('autocast') === '1') {
      requestAutoCast();
    }

    return () => {
      cancelled = true;
      unsubscribeLibrary();
      disposePlayer();
    };
  }, [user?.uid]);

  if (!ready) {
    return <CenteredMessage>Loading…</CenteredMessage>;
  }

  if (!user || !isAllowed(user)) {
    return <SignInScreen />;
  }

  if (!libraryReady) {
    return <CenteredMessage>Loading your library…</CenteredMessage>;
  }

  return (
    <>
      {activeTab.value === 'player' ? <Player /> : <Library uid={user.uid} />}
      <TabBar />
      <Toast />
    </>
  );
}

function CenteredMessage({ children }: { children: ComponentChildren }) {
  return (
    <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)' }}>
      {children}
    </main>
  );
}
