import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function buildFixtureWebDist(): string {
  const webDistDir = tempDir('worldbookllm-web-dist-');
  mkdirSync(join(webDistDir, 'assets'), { recursive: true });
  writeFileSync(join(webDistDir, 'index.html'), '<!doctype html><title>worldbookllm</title>');
  writeFileSync(join(webDistDir, 'assets', 'app.js'), 'console.log("built app shell");');
  return webDistDir;
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('production static web serving (ADR 0002)', () => {
  it('serves the built app, its assets, and an SPA fallback for client routes', async () => {
    const dataDir = tempDir('worldbookllm-app-');
    const webDistDir = buildFixtureWebDist();
    const app: FastifyInstance = buildApp({ dataDir, webDistDir, logger: false });

    const root = await app.inject({ method: 'GET', url: '/' });
    expect(root.statusCode).toBe(200);
    expect(root.body).toContain('worldbookllm');

    const asset = await app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.body).toBe('console.log("built app shell");');

    const clientRoute = await app.inject({ method: 'GET', url: '/notebooks/some-id' });
    expect(clientRoute.statusCode).toBe(200);
    expect(clientRoute.body).toBe(root.body);

    const missingApiRoute = await app.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(missingApiRoute.statusCode).toBe(404);
    expect(missingApiRoute.json()).toMatchObject({ error: 'not_found' });

    await app.close();
  });

  it('falls back to a plain 404 when no web build is present', async () => {
    const dataDir = tempDir('worldbookllm-app-');
    const missingWebDistDir = join(tempDir('worldbookllm-web-dist-empty-'), 'does-not-exist');
    const app: FastifyInstance = buildApp({
      dataDir,
      webDistDir: missingWebDistDir,
      logger: false,
    });

    const root = await app.inject({ method: 'GET', url: '/' });
    expect(root.statusCode).toBe(404);
    expect(root.json()).toMatchObject({ error: 'not_found' });

    const missingApiRoute = await app.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(missingApiRoute.statusCode).toBe(404);
    expect(missingApiRoute.json()).toMatchObject({ error: 'not_found' });

    await app.close();
  });
});
