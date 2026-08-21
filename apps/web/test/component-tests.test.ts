import { existsSync, readdirSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Every React component in this app has a test next to it.
 *
 * The rule used to be "everything in `components/`", which is a rule about a
 * directory rather than about components — and five route islands worth about
 * 1,150 lines, three of them calling server actions, sat outside it untested.
 * That is exactly the kind of gap a convention nobody can check will keep
 * producing, so it is checked here instead of remembered.
 *
 * The exclusions are the files Next owns rather than the app: a `page.tsx` is
 * a route entry that composes a query and an island, and is covered by the
 * island's test and by the route tests; `layout`, `loading`, `error` and
 * `not-found` are framework slots.
 */

const WEB = fileURLToPath(new URL('..', import.meta.url));
const ROOTS = ['app', 'components', 'src'];

/** Framework slots, not components this app is responsible for testing. */
const FRAMEWORK_FILES = [
  'layout.tsx',
  'page.tsx',
  'loading.tsx',
  'error.tsx',
  'not-found.tsx',
  'template.tsx',
  'global-error.tsx',
];

function tsxFilesIn(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    // A root that does not exist yet is not a failure; `src/` had no
    // components at all when this was written.
    return [];
  }
  return entries.flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFilesIn(full);
    return entry.name.endsWith('.tsx') ? [full] : [];
  });
}

const componentFiles = ROOTS.flatMap((root) => tsxFilesIn(join(WEB, root)))
  .filter((file) => !file.endsWith('.test.tsx'))
  .filter((file) => !FRAMEWORK_FILES.includes(basename(file)))
  .sort();

describe('every component file', () => {
  it('was found, so this test is not silently checking nothing', () => {
    expect(componentFiles.length).toBeGreaterThan(8);
  });

  it('has a colocated test', () => {
    const untested = componentFiles
      .filter((file) => !existsSync(`${file.slice(0, -'.tsx'.length)}.test.tsx`))
      .map((file) => relative(WEB, file));

    expect(untested).toEqual([]);
  });
});
