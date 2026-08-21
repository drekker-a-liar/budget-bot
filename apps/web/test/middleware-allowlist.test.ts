import { describe, expect, it } from 'vitest';
import { config } from '@/middleware';
import { PUBLIC_PATHS, isPublicPath } from '@/lib/publicPaths';
import { appUrlPaths } from './helpers/appRoutes';

/**
 * Fail closed, checked against the routes that actually exist.
 *
 * The risk this pins: someone adds `app/settings/page.tsx` or
 * `app/api/export/route.ts`, the matcher's exclusion list happens to swallow
 * it, and the new surface is served to anyone who asks. Rather than trust a
 * reading of the regex, every route in the tree is walked and has to land on
 * one side or the other on purpose.
 */

const MATCHER = new RegExp(`^${config.matcher[0]}$`);

const paths = appUrlPaths();

describe('every route in app/', () => {
  it('was found, so this test is not silently checking nothing', () => {
    expect(paths).toContain('/');
    expect(paths).toContain('/api/data');
    expect(paths.length).toBeGreaterThan(5);
  });

  it.each(paths)('%s is either public on purpose or behind the middleware', (path) => {
    const behindMiddleware = MATCHER.test(path);
    const publicOnPurpose = isPublicPath(path);

    expect(behindMiddleware || publicOnPurpose).toBe(true);
    // Never both: a path the matcher covers is not "public", and a public path
    // must not be reached by a middleware that would redirect it in a loop.
    expect(behindMiddleware && publicOnPurpose).toBe(false);
  });
});

describe('the public allow list', () => {
  it('is the one from the spec, in full', () => {
    // §7 names these five and nothing else. `/privacy` and the Plaid webhook
    // do not exist yet; they are listed now so adding them in a later phase is
    // not a change to the security boundary.
    expect([...PUBLIC_PATHS]).toEqual([
      '/login',
      '/privacy',
      '/api/auth',
      '/api/webhooks/plaid',
      '/api/health',
    ]);
  });
});
