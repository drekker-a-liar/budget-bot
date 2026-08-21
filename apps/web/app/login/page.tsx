import { redirect } from 'next/navigation';
import { auth, signIn } from '@/auth';
import { E2E_PROVIDER_ID, isE2eSignInEnabled } from '@/lib/e2eProvider';

/**
 * The only page reachable without a session (spec §7).
 *
 * A server component: it has to ask the database whether the visitor is
 * already signed in, and the sign-in itself is a server action, so there is
 * nothing here for a client bundle to do.
 */

/**
 * `?error=` carries an Auth.js error code. Only the one that is the visitor's
 * business is spelled out - "you completed the GitHub handshake and this
 * deployment still does not want you" is otherwise a baffling thing to have
 * happen. Every other code is an operator's problem, and the code itself is
 * never rendered: it is a string a stranger controls.
 */
const ACCESS_DENIED = "This email isn't on the allow list for this deployment.";
const SOMETHING_WENT_WRONG =
  'Sign-in did not complete. Check the deployment logs, or try again.';

function messageFor(error: string | undefined): string | null {
  if (!error) return null;
  return error === 'AccessDenied' ? ACCESS_DENIED : SOMETHING_WENT_WRONG;
}

interface LoginPageProps {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  if (await auth()) redirect('/');

  const params = await searchParams;
  const message = messageFor(params.error);
  const callbackUrl = params.callbackUrl ?? '/';

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
      }}
    >
      <div className="swiss-card" style={{ width: '100%', maxWidth: '380px', padding: '2rem' }}>
        <div className="swiss-label" style={{ marginBottom: '0.35rem' }}>
          Budget Bot {'// Trade Ops'}
        </div>
        <h1 className="swiss-header" style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>
          Sign in
        </h1>
        <p
          style={{
            color: 'var(--text-secondary)',
            fontSize: '0.825rem',
            marginBottom: '1.5rem',
          }}
        >
          This deployment is private. Only the addresses its owner put on the allow list can
          reach the books.
        </p>

        {message && (
          <p
            role="alert"
            style={{
              background: 'var(--severity-critical-bg)',
              border: '1px solid var(--severity-critical-border)',
              color: 'var(--severity-critical)',
              borderRadius: '6px',
              padding: '0.65rem 0.85rem',
              fontSize: '0.8rem',
              marginBottom: '1.25rem',
            }}
          >
            {message}
          </p>
        )}

        <form
          action={async () => {
            'use server';
            // Auth.js resolves `redirectTo` against this deployment's own
            // origin, so a `callbackUrl` pointing elsewhere cannot turn the
            // sign-in page into an open redirect.
            await signIn('github', { redirectTo: callbackUrl });
          }}
        >
          <button type="submit" className="btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
            Sign in with GitHub
          </button>
        </form>

        {/*
          The Playwright suite's way in, and nothing else's: `E2E=1` is a local
          test run, and a production deployment with it set refuses to boot
          (spec §7, lib/e2eProvider.ts). It is rendered rather than driven
          headlessly so the suite goes through the same page a person does.
        */}
        {isE2eSignInEnabled() && (
          <form
            action={async (formData: FormData) => {
              'use server';
              await signIn(E2E_PROVIDER_ID, {
                email: String(formData.get('email') ?? ''),
                redirectTo: callbackUrl,
              });
            }}
            style={{ marginTop: '1.25rem', borderTop: '1px solid var(--border-subtle)', paddingTop: '1.25rem' }}
          >
            <label className="swiss-label" htmlFor="e2e-email">
              End-to-end test sign-in
            </label>
            <input
              id="e2e-email"
              name="email"
              type="email"
              className="form-input"
              placeholder="allow-listed address"
              style={{ marginTop: '0.25rem', width: '100%' }}
            />
            <button
              type="submit"
              className="btn-secondary"
              style={{ width: '100%', justifyContent: 'center', marginTop: '0.5rem' }}
            >
              Sign in for tests
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
