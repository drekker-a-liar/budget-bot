import { handlers } from '@/auth';

/**
 * Auth.js's own endpoints: the GitHub redirect, the OAuth callback, sign-out,
 * the CSRF token and the session lookup. This is the one route in the app that
 * is deliberately reachable without a session - it is how a session is made.
 */
export const { GET, POST } = handlers;
