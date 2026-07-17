import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import matter from 'gray-matter';
import { z } from 'zod';

import {
  conversionNotesSchema,
  sourceCategorySchema,
  sourceOriginSchema,
  sourceTagsSchema,
  type SourceCategory,
  type SourceOrigin,
} from '@worldbookllm/shared';

import { InvalidStoredDataError, UnsafePathError } from '../errors.js';

const frontmatterSchema = z.strictObject({
  id: z.uuid(),
  notebookId: z.uuid(),
  title: z.string().trim().min(1).max(300),
  // Database migrations cannot rewrite legacy source-of-truth Markdown files.
  origin: z
    .union([sourceOriginSchema, z.literal('paste')])
    .transform((origin): SourceOrigin => (origin === 'paste' ? { type: 'paste' } : origin)),
  conversionNotes: conversionNotesSchema.default([]),
  // Optional so files written before M3 (and hand-authored files) still parse.
  category: sourceCategorySchema.nullable().default(null),
  tags: sourceTagsSchema.default([]),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const managedFrontmatterKeys = new Set<string>(frontmatterSchema.keyof().options);

function partitionFrontmatter(data: Record<string, unknown>) {
  const managed: Record<string, unknown> = {};
  const user: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    (managedFrontmatterKeys.has(key) ? managed : user)[key] = value;
  }
  return { managed, user };
}

export interface SourceFileInput {
  id: string;
  notebookId: string;
  title: string;
  content: string;
  origin: SourceOrigin;
  conversionNotes: string[];
  category: SourceCategory | null;
  tags: string[];
  createdAt: string;
  updatedAt?: string;
}

export interface StoredSourceFile {
  filePath: string;
  slug: string;
  wordCount: number;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReadSourceFile {
  id: string;
  notebookId: string;
  title: string;
  origin: SourceOrigin;
  conversionNotes: string[];
  category: SourceCategory | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  content: string;
  wordCount: number;
  contentHash: string;
}

export function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 200);
  return slug || 'source';
}

function deriveContentMetadata(content: string): Pick<ReadSourceFile, 'wordCount' | 'contentHash'> {
  const trimmed = content.trim();
  return {
    wordCount: trimmed === '' ? 0 : trimmed.split(/\s+/u).length,
    contentHash: createHash('sha256').update(content).digest('hex'),
  };
}

export class SourceFileStore {
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

  write(input: SourceFileInput): StoredSourceFile {
    const slug = slugify(input.title);
    const filePath = join(
      'notebooks',
      input.notebookId,
      'sources',
      `${input.id}-${slug}.md`,
    ).replaceAll(sep, '/');
    const absolutePath = this.resolveRelative(filePath);
    const directory = resolve(absolutePath, '..');
    const updatedAt = input.updatedAt ?? input.createdAt;
    const rendered = matter.stringify({ content: input.content, data: {} } as { content: string }, {
      id: input.id,
      notebookId: input.notebookId,
      title: input.title,
      origin: input.origin,
      conversionNotes: input.conversionNotes,
      // Omitted when unset so uncategorized/untagged files keep the legacy shape.
      ...(input.category === null ? {} : { category: input.category }),
      ...(input.tags.length === 0 ? {} : { tags: input.tags }),
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
      filePath,
      slug,
      ...deriveContentMetadata(input.content),
      createdAt: input.createdAt,
      updatedAt,
    };
  }

  read(relativePath: string): ReadSourceFile {
    const absolutePath = this.resolveRelative(relativePath);
    try {
      const parsed = matter(readFileSync(absolutePath, 'utf8'));
      const { managed, user } = partitionFrontmatter(parsed.data);
      const frontmatter = frontmatterSchema.parse(managed);
      const content =
        Object.keys(user).length === 0
          ? parsed.content
          : matter.stringify({ content: parsed.content, data: {} } as { content: string }, user);
      return {
        ...frontmatter,
        content,
        ...deriveContentMetadata(content),
      };
    } catch (error) {
      if (error instanceof UnsafePathError) throw error;
      throw new InvalidStoredDataError(`Could not read source file ${relativePath}`, {
        cause: error,
      });
    }
  }

  remove(relativePath: string): void {
    const absolutePath = this.resolveRelative(relativePath);
    try {
      unlinkSync(absolutePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  removeNotebook(notebookId: string): void {
    const absolutePath = this.resolveRelative(join('notebooks', notebookId));
    rmSync(absolutePath, { recursive: true, force: true });
  }
}
