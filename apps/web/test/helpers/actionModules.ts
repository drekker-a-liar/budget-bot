import { readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

/**
 * Reading the server actions off disk.
 *
 * A Server Action is a POST endpoint with a stable id in the client bundle, so
 * it is as reachable as a route handler and needs the same gating - and
 * `route-gating.test.ts` walks `app/api` from disk precisely because the way
 * that rule gets broken is somebody adding a surface and not thinking about
 * it. The action list used to be typed out by hand, so a new
 * `src/server/actions/export.ts` that forgot `currentOwnerId()` would have
 * been caught by nothing.
 */

export const ACTIONS_DIR = fileURLToPath(
  new URL('../../src/server/actions', import.meta.url)
);

/**
 * The files in that directory that are not actions.
 *
 * Named one by one rather than matched by a pattern: adding a fourth helper
 * means adding a line here, which is a moment for somebody to be sure it is a
 * helper. `inputs.ts` is the form schemas, `result.ts` is the `ActionResult`
 * shape every action returns, `revalidate.ts` is the one-line cache
 * invalidation they all call.
 */
export const NOT_ACTIONS = ['inputs.ts', 'result.ts', 'revalidate.ts'];

/** Every `src/server/actions/*.ts` that is expected to export actions. */
export function actionModuleFiles(): string[] {
  return readdirSync(ACTIONS_DIR)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .filter((name) => !NOT_ACTIONS.includes(name))
    .sort()
    .map((name) => join(ACTIONS_DIR, name));
}

export interface LoadedAction {
  /** `createProjectAction`. */
  name: string;
  /** `projects.ts`, for a failure message that says where to look. */
  module: string;
  value: unknown;
}

/**
 * Every export whose name ends in `Action`, from every action module, in a
 * stable order. Imported dynamically so that the mocks this file's callers
 * install at the module boundary are the ones the actions see.
 */
export async function loadActions(): Promise<LoadedAction[]> {
  const loaded: LoadedAction[] = [];

  for (const file of actionModuleFiles()) {
    const imported: Record<string, unknown> = await import(pathToFileURL(file).href);
    for (const [name, value] of Object.entries(imported)) {
      if (name.endsWith('Action')) loaded.push({ name, module: basename(file), value });
    }
  }

  return loaded.sort((a, b) => a.name.localeCompare(b.name));
}
