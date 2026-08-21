// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Session } from 'next-auth';

/**
 * The one page a stranger is allowed to see.
 *
 * `auth()` and `next/navigation` are mocked because they are the boundary this
 * page sits on - a session lookup and a framework redirect. Everything else is
 * the real component, rendered into a real DOM.
 */

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => null),
  signIn: vi.fn(async () => undefined),
}));

vi.mock('next/navigation', () => ({
  // The real one throws to unwind the render; a mock that returned would let
  // the signed-in case carry on and render a sign-in form nobody would see.
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

const { auth } = await import('@/auth');
const { default: LoginPage } = await import('@/app/login/page');

/**
 * `auth()` is overloaded - a session lookup and a middleware wrapper - and the
 * mock only ever stands in for the first, so it is narrowed once here rather
 * than at each call.
 */
type AuthMock = Mock<() => Promise<Session | null>>;
const authMock = auth as unknown as AuthMock;

const SIGNED_IN: Session = {
  user: { id: 'user-1', email: 'mike@example.com' },
  expires: '2026-09-01',
};

type SearchParams = { error?: string; callbackUrl?: string };

async function renderLogin(searchParams: SearchParams = {}) {
  render(await LoginPage({ searchParams }));
}

/**
 * `<form action={serverAction}>` is how Next runs a server action, and the
 * React that Next bundles understands it. The plain react-dom 18 these tests
 * render with does not, and says so on every render. The message is filtered
 * rather than the whole channel silenced, so a real warning still fails.
 */
function isFormActionWarning(args: unknown[]): boolean {
  const text = args.map(String).join(' ');
  return (
    text.includes('Invalid value for prop') &&
    text.includes('`action`') &&
    text.includes('form')
  );
}

let unexpectedWarnings: string[] = [];

beforeEach(() => {
  authMock.mockResolvedValue(null);
  unexpectedWarnings = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (!isFormActionWarning(args)) unexpectedWarnings.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  expect(unexpectedWarnings).toEqual([]);
});

describe('the sign-in page', () => {
  it('offers the one way in this deployment has', async () => {
    await renderLogin();

    expect(screen.getByRole('button', { name: /sign in with github/i })).toBeInTheDocument();
  });

  it('says nothing about an error when the visitor simply arrived', async () => {
    await renderLogin();

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('explains an allow-list refusal in the terms that caused it', async () => {
    await renderLogin({ error: 'AccessDenied' });

    expect(screen.getByRole('alert')).toHaveTextContent(
      "This email isn't on the allow list for this deployment."
    );
  });

  it('falls back to a general message for an error it does not recognise', async () => {
    await renderLogin({ error: 'Configuration' });

    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert).not.toHaveTextContent(/allow list/i);
  });

  it('never echoes the error code back into the page', async () => {
    // Auth.js puts whatever it likes in `?error=`; rendering it would be a way
    // to put a stranger's text on this deployment's sign-in page.
    await renderLogin({ error: '<script>alert(1)</script>' });

    expect(screen.getByRole('alert').textContent).not.toContain('script');
  });

  it('sends someone who is already signed in to the dashboard', async () => {
    authMock.mockResolvedValue(SIGNED_IN);

    await expect(renderLogin()).rejects.toThrow('NEXT_REDIRECT:/');
  });
});
