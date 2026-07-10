import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const DEFAULT_DATA_DIR = fileURLToPath(new URL('../../../data', import.meta.url));

export function resolveDataDir(explicit?: string): string {
  return resolve(explicit ?? process.env.DATA_DIR ?? DEFAULT_DATA_DIR);
}
