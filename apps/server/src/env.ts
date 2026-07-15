import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const DEFAULT_DATA_DIR = fileURLToPath(new URL('../../../data', import.meta.url));

export function resolveDataDir(explicit?: string): string {
  return resolve(explicit ?? process.env.DATA_DIR ?? DEFAULT_DATA_DIR);
}

// apps/server/src/env.ts and the esbuild-bundled apps/server/dist/*.js are the
// same number of path segments below the repo root, so this relative walk
// resolves correctly whether running from source (tsx) or the built bundle.
const DEFAULT_WEB_DIST_DIR = fileURLToPath(new URL('../../../apps/web/dist', import.meta.url));

/** The built web app (apps/web/dist), served directly in production (ADR 0002). */
export function resolveWebDistDir(explicit?: string): string {
  return resolve(explicit ?? process.env.WEB_DIST_DIR ?? DEFAULT_WEB_DIST_DIR);
}
