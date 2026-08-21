#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/**
 * `eslint --fix` over what is staged, and nothing else. Run by lefthook's
 * pre-commit hook (see lefthook.yml).
 *
 * There is no single `eslint` to run at the root of this monorepo: `apps/web`
 * is on eslint 8 with the Next config and the packages are on eslint 9 with a
 * flat one. So the staged files are grouped by the workspace that owns them
 * and each group is handed to that workspace's own eslint - which is also the
 * one CI will use, so a hook that passes is not a promise CI will break.
 *
 * Anything it fixes is re-staged. Anything it cannot fix fails the commit.
 */

const ROOT = resolve(import.meta.dirname, '..');
const LINTABLE = /\.(ts|tsx|mts)$/;

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
}

/** Staged files that still exist: a deletion has nothing to lint. */
function stagedFiles() {
  return git('diff', '--cached', '--name-only', '--diff-filter=ACMR')
    .split('\n')
    .map((line) => line.trim())
    .filter((file) => file && LINTABLE.test(file) && existsSync(join(ROOT, file)));
}

/** The workspace package a file belongs to: the nearest package.json above it. */
function workspaceFor(file) {
  let dir = dirname(join(ROOT, file));
  while (dir.startsWith(ROOT) && dir !== ROOT) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) {
      return { dir, name: JSON.parse(readFileSync(manifest, 'utf8')).name };
    }
    dir = dirname(dir);
  }
  return null;
}

const groups = new Map();
for (const file of stagedFiles()) {
  const workspace = workspaceFor(file);
  // A file at the root of the monorepo belongs to no package's eslint. There
  // are only a handful and CI's `turbo lint` does not cover them either.
  if (!workspace) continue;
  const group = groups.get(workspace.name) ?? { dir: workspace.dir, files: [] };
  group.files.push(relative(workspace.dir, join(ROOT, file)));
  groups.set(workspace.name, group);
}

if (groups.size === 0) process.exit(0);

for (const [name, { files }] of groups) {
  execFileSync('pnpm', ['--filter', name, 'exec', 'eslint', '--fix', ...files], {
    cwd: ROOT,
    stdio: 'inherit',
  });
}

// `--fix` rewrites files that are already staged, so what would be committed
// is the unfixed version unless they are staged again.
git('add', '--', ...[...groups.values()].flatMap(({ dir, files }) =>
  files.map((file) => relative(ROOT, join(dir, file)))
));
