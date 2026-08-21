import type { DefaultSession } from 'next-auth';

/**
 * Auth.js types `session.user.id` as optional because a JWT session need not
 * carry one. This deployment uses database sessions (ADR 0003), where the id
 * is always the `users` row, and every query is scoped by it - so it is
 * declared required and the compiler enforces it at each call site.
 */
declare module 'next-auth' {
  interface Session {
    user: { id: string } & DefaultSession['user'];
  }
}
