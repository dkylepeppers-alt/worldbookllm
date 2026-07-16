import { createHash, randomUUID } from 'node:crypto';
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
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import matter from 'gray-matter';
import { z } from 'zod';

import {
  skillDescriptionSchema,
  skillNameSchema,
  skillOriginSchema,
  type SkillOrigin,
} from '@worldbookllm/shared';

import { InvalidStoredDataError, UnsafePathError } from '../errors.js';

// agentskills.io spec fields (name, description, license) plus
// worldbookllm-managed identity keys, which the spec permits as extras.
const frontmatterSchema = z.looseObject({
  name: skillNameSchema,
  description: skillDescriptionSchema,
  license: z.string().trim().min(1).max(200).nullable().default(null),
  id: z.uuid(),
  origin: skillOriginSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export interface SkillFileInput {
  id: string;
  name: string;
  description: string;
  content: string;
  origin: SkillOrigin;
  license: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface StoredSkillFile {
  dirPath: string;
  wordCount: number;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReadSkillFile {
  id: string;
  name: string;
  description: string;
  origin: SkillOrigin;
  license: string | null;
  createdAt: string;
  updatedAt: string;
  content: string;
  wordCount: number;
  contentHash: string;
}

function deriveContentMetadata(content: string): Pick<ReadSkillFile, 'wordCount' | 'contentHash'> {
  const trimmed = content.trim();
  return {
    wordCount: trimmed === '' ? 0 : trimmed.split(/\s+/u).length,
    contentHash: createHash('sha256').update(content).digest('hex'),
  };
}

export class SkillFileStore {
  readonly dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = resolve(dataDir);
    mkdirSync(this.dataDir, { recursive: true });
  }

  private resolveRelative(relativePath: string): string {
    if (isAbsolute(relativePath)) throw new UnsafePathError(relativePath);
    const absolutePath = resolve(this.dataDir, relativePath);
    const fromRoot = relative(this.dataDir, absolutePath);
    if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
      throw new UnsafePathError(relativePath);
    }
    return absolutePath;
  }

  write(input: SkillFileInput): StoredSkillFile {
    const dirPath = join('skills', input.name).replaceAll(sep, '/');
    const absolutePath = this.resolveRelative(join(dirPath, 'SKILL.md'));
    const directory = resolve(absolutePath, '..');
    const updatedAt = input.updatedAt ?? input.createdAt;
    const rendered = matter.stringify(input.content, {
      name: input.name,
      description: input.description,
      ...(input.license === null ? {} : { license: input.license }),
      id: input.id,
      origin: input.origin,
      createdAt: input.createdAt,
      updatedAt,
    });
    const serialized = input.content.endsWith('\n') ? rendered : rendered.replace(/\n$/u, '');

    mkdirSync(directory, { recursive: true });
    const temporaryPath = `${absolutePath}.${randomUUID()}.tmp`;
    let descriptor: number | undefined;
    try {
      descriptor = openSync(temporaryPath, 'wx', 0o600);
      writeFileSync(descriptor, serialized, 'utf8');
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      renameSync(temporaryPath, absolutePath);
      chmodSync(absolutePath, 0o600);
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      rmSync(temporaryPath, { force: true });
      throw error;
    }

    return {
      dirPath,
      ...deriveContentMetadata(input.content),
      createdAt: input.createdAt,
      updatedAt,
    };
  }

  read(dirPath: string): ReadSkillFile {
    const absolutePath = this.resolveRelative(join(dirPath, 'SKILL.md'));
    try {
      const parsed = matter(readFileSync(absolutePath, 'utf8'));
      const frontmatter = frontmatterSchema.parse(parsed.data);
      return {
        id: frontmatter.id,
        name: frontmatter.name,
        description: frontmatter.description,
        origin: frontmatter.origin,
        license: frontmatter.license,
        createdAt: frontmatter.createdAt,
        updatedAt: frontmatter.updatedAt,
        content: parsed.content,
        ...deriveContentMetadata(parsed.content),
      };
    } catch (error) {
      if (error instanceof UnsafePathError) throw error;
      throw new InvalidStoredDataError(`Could not read skill file ${dirPath}/SKILL.md`, {
        cause: error,
      });
    }
  }

  /** True when a SKILL.md already exists at this directory path on disk. */
  has(dirPath: string): boolean {
    return existsSync(this.resolveRelative(join(dirPath, 'SKILL.md')));
  }

  /**
   * Moves a whole skill directory (a rename carries any extra files —
   * references/, scripts/ — along with SKILL.md).
   */
  move(fromDirPath: string, toDirPath: string): void {
    const fromAbsolute = this.resolveRelative(fromDirPath);
    const toAbsolute = this.resolveRelative(toDirPath);
    mkdirSync(resolve(toAbsolute, '..'), { recursive: true });
    renameSync(fromAbsolute, toAbsolute);
  }

  /** Removes a skill directory and everything in it (extra files included). */
  remove(dirPath: string): void {
    const absolutePath = this.resolveRelative(dirPath);
    rmSync(absolutePath, { recursive: true, force: true });
  }
}
