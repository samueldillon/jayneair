import { authError, isAllowed, signIn, signOutUser, currentUser } from '../lib/auth';

export function SignInScreen() {
  const user = currentUser.value;
  const blocked = !!user && !isAllowed(user);

  return (
    <main
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-5)',
        padding: 'var(--space-6)',
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontSize: '2.5rem', margin: 0, color: 'var(--accent)' }}>Jayne Air</h1>
      <p style={{ color: 'var(--text-dim)', maxWidth: 340, margin: 0 }}>
        Your personal podcast radio station. Sign in to load your library.
      </p>

      {blocked ? (
        <>
          <p style={{ color: 'var(--danger)', maxWidth: 340 }}>
            {user!.email} isn&apos;t on the allow-list for this app.
          </p>
          <button onClick={signOutUser} style={buttonStyle}>
            Sign out and try another account
          </button>
        </>
      ) : (
        <button onClick={signIn} style={buttonStyle}>
          Sign in with Google
        </button>
      )}

      {authError.value && <p style={{ color: 'var(--danger)' }}>{authError.value}</p>}
    </main>
  );
}

const buttonStyle = {
  background: 'var(--accent)',
  color: 'var(--accent-contrast)',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  padding: '14px 28px',
  fontSize: '1rem',
  fontWeight: 600,
};
