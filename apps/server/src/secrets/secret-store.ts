import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

import { type MaskedSecret, secretKeySchema, type SecretState } from '@worldbookllm/shared';
import { z } from 'zod';

import { InvalidStoredDataError, NotFoundError } from '../errors.js';

const secretValueSchema = z.strictObject({
  id: z.uuid(),
  value: z.string(),
  label: z.string(),
  active: z.boolean(),
});

const secretFileSchema = z
  .record(secretKeySchema, z.array(secretValueSchema))
  .superRefine((secrets, context) => {
    for (const [key, entries] of Object.entries(secrets)) {
      const activeCount = entries.filter((entry) => entry.active).length;
      if ((entries.length > 0 && activeCount !== 1) || activeCount > 1) {
        context.addIssue({
          code: 'custom',
          message: `Secret key ${key} must have exactly one active entry`,
          path: [key],
        });
      }
    }
  });

type SecretValue = z.infer<typeof secretValueSchema>;
type SecretFile = z.infer<typeof secretFileSchema>;

function maskSecret(value: string): string {
  if (value.length <= 10) return '*'.repeat(10);
  return `${'*'.repeat(7)}${value.slice(-3)}`;
}

function toMasked(secret: SecretValue): MaskedSecret {
  return {
    id: secret.id,
    value: maskSecret(secret.value),
    label: secret.label,
    active: secret.active,
  };
}

export class SecretStore {
  readonly filePath: string;

  constructor(dataDir: string) {
    const absoluteDataDir = resolve(dataDir);
    mkdirSync(absoluteDataDir, { recursive: true });
    this.filePath = join(absoluteDataDir, 'secrets.json');
    if (!existsSync(this.filePath)) {
      this.writeSecrets({});
    } else {
      chmodSync(this.filePath, 0o600);
    }
  }

  private readSecrets(): SecretFile {
    try {
      return secretFileSchema.parse(JSON.parse(readFileSync(this.filePath, 'utf8')));
    } catch (error) {
      throw new InvalidStoredDataError('The secrets file is invalid', { cause: error });
    }
  }

  private writeSecrets(secrets: SecretFile): void {
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    let descriptor: number | undefined;
    try {
      descriptor = openSync(temporaryPath, 'wx', 0o600);
      writeFileSync(descriptor, `${JSON.stringify(secrets, null, 2)}\n`, 'utf8');
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      renameSync(temporaryPath, this.filePath);
      chmodSync(this.filePath, 0o600);
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      rmSync(temporaryPath, { force: true });
      throw error;
    }
  }

  getState(): SecretState {
    const state: SecretState = {};
    for (const [key, entries] of Object.entries(this.readSecrets())) {
      if (entries.length > 0) state[key] = entries.map(toMasked);
    }
    return state;
  }

  add(key: string, value: string, label: string): MaskedSecret {
    const secrets = this.readSecrets();
    const entries = secrets[key] ?? [];
    for (const entry of entries) entry.active = false;

    const created: SecretValue = { id: randomUUID(), value, label, active: true };
    entries.push(created);
    secrets[key] = entries;
    this.writeSecrets(secrets);
    return toMasked(created);
  }

  activate(key: string, id: string): MaskedSecret {
    const secrets = this.readSecrets();
    const entries = secrets[key];
    if (!entries) throw new NotFoundError(`Secret key ${key} was not found`);
    const target = entries.find((entry) => entry.id === id);
    if (!target) throw new NotFoundError(`Secret ${id} was not found for key ${key}`);

    for (const entry of entries) entry.active = false;
    target.active = true;
    this.writeSecrets(secrets);
    return toMasked(target);
  }

  delete(key: string, id: string): void {
    const secrets = this.readSecrets();
    const entries = secrets[key];
    if (!entries) throw new NotFoundError(`Secret key ${key} was not found`);
    const targetIndex = entries.findIndex((entry) => entry.id === id);
    if (targetIndex === -1) throw new NotFoundError(`Secret ${id} was not found for key ${key}`);

    entries.splice(targetIndex, 1);
    if (entries.length === 0) {
      delete secrets[key];
    } else if (!entries.some((entry) => entry.active)) {
      const fallback = entries[0];
      if (fallback) fallback.active = true;
    }
    this.writeSecrets(secrets);
  }

  readActive(key: string, id?: string): string {
    const entries = this.readSecrets()[key];
    if (!entries) return '';
    return entries.find((entry) => (id ? entry.id === id : entry.active))?.value ?? '';
  }
}
