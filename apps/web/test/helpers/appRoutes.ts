import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Reading the route tree off disk.
 *
 * Two tests turn on the same question - what does this app actually serve? -
 * and both of them are worthless if the answer is a list somebody typed. The
 * failure they exist to catch *is* somebody adding a route and not thinking
 * about it, which a hand-written list cannot notice by construction.
 */

export const APP_DIR = fileURLToPath(new URL('../../app', import.meta.url));

/** Every `route.ts` and `page.tsx` under `dir`, recursively. */
export function routeFiles(dir: string, names = ['route.ts', 'page.tsx']): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full, names);
    return names.includes(entry.name) ? [full] : [];
  });
}

/**
 * `app/projects/[id]/page.tsx` -> `/projects/sample`.
 *
 * Dynamic segments become a stand-in value, because what the tests ask is
 * whether the *route* is reachable, not which record it would return.
 */
export function urlPathOf(file: string): string {
  const segments = relative(APP_DIR, file)
    .split(sep)
    .slice(0, -1)
    // Route groups - `(marketing)` - organise files without appearing in URLs.
    .filter((segment) => !segment.startsWith('('))
    .map((segment) => (segment.startsWith('[') ? 'sample' : segment));
  return `/${segments.join('/')}`.replace(/\/$/, '') || '/';
}

/** Every URL path the app serves, deduplicated and sorted. */
export function appUrlPaths(): string[] {
  return [...new Set(routeFiles(APP_DIR).map(urlPathOf))].sort();
}

export interface ApiRoute {
  /** The URL path, e.g. `/api/projects/sample`. */
  path: string;
  /** Absolute path of the `route.ts`, for importing it. */
  file: string;
}

/** Every `app/api/**\/route.ts`, as a URL path and a file to import. */
export function apiRoutes(): ApiRoute[] {
  return routeFiles(join(APP_DIR, 'api'), ['route.ts'])
    .map((file) => ({ path: urlPathOf(file), file }))
    .sort((a, b) => a.path.localeCompare(b.path));
}
