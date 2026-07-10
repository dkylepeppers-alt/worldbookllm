import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { InvalidStoredDataError, NotFoundError } from '../errors.js';
import { SecretStore } from './secret-store.js';

const tempDirs: string[] = [];

function makeDataDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'worldbookllm-secrets-'));
  tempDirs.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('SecretStore', () => {
  it('creates a private atomic secrets file and always masks public state', () => {
    const dataDir = makeDataDir();
    const store = new SecretStore(dataDir);
    const first = store.add('api_key_openrouter', 'sk-first-123456', 'First');
    const second = store.add('api_key_openrouter', 'sk-second-987654', 'Second');

    expect(first).toEqual({
      id: expect.any(String),
      value: '*******456',
      label: 'First',
      active: true,
    });
    expect(store.getState()).toEqual({
      api_key_openrouter: [
        { id: first.id, value: '*******456', label: 'First', active: false },
        { id: second.id, value: '*******654', label: 'Second', active: true },
      ],
    });
    expect(store.readActive('api_key_openrouter')).toBe('sk-second-987654');
    expect(JSON.stringify(store.getState())).not.toContain('sk-second');

    const file = join(dataDir, 'secrets.json');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readdirSync(dataDir)).toEqual(['secrets.json']);
  });

  it('masks short values without exposing any characters', () => {
    const store = new SecretStore(makeDataDir());

    expect(store.add('api_key_custom', 'tiny', 'Local').value).toBe('**********');
  });

  it('activates one named secret and can read an explicit ID internally', () => {
    const store = new SecretStore(makeDataDir());
    const first = store.add('api_key_nanogpt', 'first-secret-value', 'First');
    const second = store.add('api_key_nanogpt', 'second-secret-value', 'Second');

    expect(store.activate('api_key_nanogpt', first.id)).toEqual({
      ...first,
      active: true,
    });
    expect(store.readActive('api_key_nanogpt')).toBe('first-secret-value');
    expect(store.readActive('api_key_nanogpt', second.id)).toBe('second-secret-value');
    expect(store.getState().api_key_nanogpt?.filter((secret) => secret.active)).toHaveLength(1);
  });

  it('deletes secrets and activates the first remaining fallback', () => {
    const store = new SecretStore(makeDataDir());
    const first = store.add('api_key_openai', 'first-secret-value', 'First');
    const second = store.add('api_key_openai', 'second-secret-value', 'Second');

    store.delete('api_key_openai', second.id);
    expect(store.getState().api_key_openai).toEqual([{ ...first, active: true }]);
    store.delete('api_key_openai', first.id);
    expect(store.getState()).toEqual({});
    expect(store.readActive('api_key_openai')).toBe('');
  });

  it('reports unknown key and IDs without including secret values', () => {
    const store = new SecretStore(makeDataDir());
    const entry = store.add('api_key_openai', 'never-leak-this-value', 'Primary');

    expect(() => store.activate('missing', entry.id)).toThrow(NotFoundError);
    expect(() => store.activate('api_key_openai', crypto.randomUUID())).toThrow(NotFoundError);
    expect(() => store.delete('api_key_openai', crypto.randomUUID())).toThrow(NotFoundError);
    try {
      store.delete('api_key_openai', crypto.randomUUID());
    } catch (error) {
      expect(String(error)).not.toContain('never-leak');
    }
  });

  it('fails closed on corrupt or multiply-active JSON without replacing it', () => {
    const dataDir = makeDataDir();
    const file = join(dataDir, 'secrets.json');
    writeFileSync(file, '{broken', { mode: 0o600 });
    const corrupt = new SecretStore(dataDir);
    expect(() => corrupt.getState()).toThrow(InvalidStoredDataError);
    expect(readFileSync(file, 'utf8')).toBe('{broken');

    writeFileSync(
      file,
      JSON.stringify({
        key: [
          { id: crypto.randomUUID(), value: 'one', label: 'One', active: true },
          { id: crypto.randomUUID(), value: 'two', label: 'Two', active: true },
        ],
      }),
      { mode: 0o600 },
    );
    expect(() => corrupt.getState()).toThrow(InvalidStoredDataError);
  });
});
