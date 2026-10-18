/**
 * Repository-relative paths used by the zero-dependency developer CLI.
 * Everything resolves from `scripts/cli/lib/`; no network, no env assumptions.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repository root (the `dsh-game-market` checkout that contains `scripts/cli`). */
export const REPO_ROOT = path.resolve(here, '../../..');

/** Inline SDK entry bundled into every build unless `sdk:false` is configured. */
export const SDK_ENTRY = path.join(REPO_ROOT, 'packages/sdk/src/sdk.js');
export const SDK_TYPES = path.join(REPO_ROOT, 'packages/sdk/src/index.d.ts');
export const SHARED_SRC = path.join(REPO_ROOT, 'packages/shared/src');

/** `templates/` root shipped with the bundle. */
export const TEMPLATES_ROOT = path.join(REPO_ROOT, 'templates');

/** CLI entry used by generated projects' build scripts. */
export const CLI_ENTRY = path.join(REPO_ROOT, 'scripts/cli/dsh-game.mjs');
export const CREATE_ENTRY = path.join(REPO_ROOT, 'scripts/cli/create-dsh-game.mjs');

export function isInside(parent, child) {
  const root = path.resolve(parent);
  const target = path.resolve(child);
  return target === root || target.startsWith(root + path.sep);
}

/** Resolve a project-relative reference and refuse path escapes. */
export function resolveInside(projectDir, reference) {
  const root = path.resolve(projectDir);
  const target = path.resolve(root, reference);
  if (!isInside(root, target)) {
    const error = new Error(`Path escapes the project directory: ${reference}`);
    error.code = 'E_CLI_PATH_ESCAPE';
    throw error;
  }
  return target;
}
