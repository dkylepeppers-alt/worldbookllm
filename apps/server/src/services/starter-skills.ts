import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import matter from 'gray-matter';
import { z } from 'zod';

import {
  type SkillMetadata,
  type StarterSkill,
  skillDescriptionSchema,
  skillNameSchema,
  starterSkillSchema,
} from '@worldbookllm/shared';

import { InvalidStoredDataError, NotFoundError } from '../errors.js';
import type { SkillService } from './skills.js';

// Vendored upstream SKILL.md frontmatter: the agentskills.io required fields
// plus whatever extra keys the author shipped (ignored).
const starterFrontmatterSchema = z.looseObject({
  name: skillNameSchema,
  description: skillDescriptionSchema,
  license: z.string().trim().min(1).max(200).optional(),
});

interface StarterSkillFile {
  starterId: string;
  name: string;
  description: string;
  license: string | null;
  content: string;
}

/**
 * The read-only starter catalog vendored into the repo (apps/server/skills-starter,
 * see its ATTRIBUTION.md). Installing copies a starter into the user's editable
 * library through the ordinary SkillService creation path.
 */
export class StarterSkillService {
  constructor(
    private readonly starterDir: string,
    private readonly skills: SkillService,
  ) {}

  private readCatalog(): StarterSkillFile[] {
    if (!existsSync(this.starterDir)) return [];
    const entries = readdirSync(this.starterDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const catalog: StarterSkillFile[] = [];
    for (const starterId of entries) {
      const skillPath = join(this.starterDir, starterId, 'SKILL.md');
      if (!existsSync(skillPath)) continue;
      try {
        const parsed = matter(readFileSync(skillPath, 'utf8'));
        const frontmatter = starterFrontmatterSchema.parse(parsed.data);
        catalog.push({
          starterId,
          name: frontmatter.name,
          description: frontmatter.description,
          license: frontmatter.license ?? null,
          content: parsed.content,
        });
      } catch (error) {
        throw new InvalidStoredDataError(`Starter skill ${starterId} has an invalid SKILL.md`, {
          cause: error,
        });
      }
    }
    return catalog;
  }

  list(): StarterSkill[] {
    const installedNames = new Set(this.skills.list().map((skill) => skill.name.toLowerCase()));
    return this.readCatalog().map((entry) =>
      starterSkillSchema.parse({
        starterId: entry.starterId,
        name: entry.name,
        description: entry.description,
        installed: installedNames.has(entry.name.toLowerCase()),
      }),
    );
  }

  /**
   * Installs the requested starters; already-installed names are skipped so
   * the call is idempotent. Returns the metadata of newly created skills.
   */
  install(starterIds: string[]): SkillMetadata[] {
    const catalog = new Map(this.readCatalog().map((entry) => [entry.starterId, entry]));
    const missing = starterIds.filter((starterId) => !catalog.has(starterId));
    if (missing.length > 0) {
      throw new NotFoundError(`Starter skill ${missing.join(', ')} was not found`);
    }
    const installedNames = new Set(this.skills.list().map((skill) => skill.name.toLowerCase()));
    const created: SkillMetadata[] = [];
    for (const starterId of starterIds) {
      const entry = catalog.get(starterId);
      if (!entry || installedNames.has(entry.name.toLowerCase())) continue;
      created.push(
        this.skills.create({
          name: entry.name,
          description: entry.description,
          content: entry.content,
          license: entry.license,
          origin: { type: 'bundled', starterId: entry.starterId },
        }),
      );
      installedNames.add(entry.name.toLowerCase());
    }
    return created;
  }
}
