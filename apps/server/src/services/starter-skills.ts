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

  /**
   * A starter counts as installed when a library skill carries its immutable
   * `starterId` (renames keep the bundled origin), or when its catalog name is
   * simply taken — installing over an occupied name could only 409.
   */
  private installedMarkers(): { starterIds: Set<string>; names: Set<string> } {
    const starterIds = new Set<string>();
    const names = new Set<string>();
    for (const skill of this.skills.list()) {
      names.add(skill.name.toLowerCase());
      if (skill.origin.type === 'bundled') starterIds.add(skill.origin.starterId);
    }
    return { starterIds, names };
  }

  list(): StarterSkill[] {
    const installed = this.installedMarkers();
    return this.readCatalog().map((entry) =>
      starterSkillSchema.parse({
        starterId: entry.starterId,
        name: entry.name,
        description: entry.description,
        installed:
          installed.starterIds.has(entry.starterId) ||
          installed.names.has(entry.name.toLowerCase()),
      }),
    );
  }

  /**
   * Installs the requested starters; already-installed starters are skipped so
   * the call is idempotent. Returns the metadata of newly created skills.
   */
  install(starterIds: string[]): SkillMetadata[] {
    const catalog = new Map(this.readCatalog().map((entry) => [entry.starterId, entry]));
    const missing = starterIds.filter((starterId) => !catalog.has(starterId));
    if (missing.length > 0) {
      throw new NotFoundError(`Starter skill ${missing.join(', ')} was not found`);
    }
    const installed = this.installedMarkers();
    const toInstall: StarterSkillFile[] = [];
    for (const starterId of starterIds) {
      const entry = catalog.get(starterId);
      if (
        !entry ||
        installed.starterIds.has(entry.starterId) ||
        installed.names.has(entry.name.toLowerCase())
      ) {
        continue;
      }
      toInstall.push(entry);
      installed.starterIds.add(entry.starterId);
      installed.names.add(entry.name.toLowerCase());
    }
    // All-or-nothing: a conflict on any entry (e.g. an unindexed folder
    // occupying a destination) must not leave the batch partially installed.
    return this.skills.createMany(
      toInstall.map((entry) => ({
        name: entry.name,
        description: entry.description,
        content: entry.content,
        license: entry.license,
        origin: { type: 'bundled' as const, starterId: entry.starterId },
      })),
    );
  }
}
