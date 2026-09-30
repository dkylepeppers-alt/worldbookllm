import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';

import matter from 'gray-matter';

import type { SkillMetadata } from '@worldbookllm/shared';

import type { SkillService } from '../services/skills.js';

/** The pinned story-skills package's skills folder. */
export function resolveStorySkillsDir(): string {
  const packageJson = createRequire(import.meta.url).resolve('story-skills/package.json');
  return join(dirname(packageJson), 'skills');
}

export interface StorySkillsInstallResult {
  installed: SkillMetadata[];
  skipped: string[];
}

function filesUnder(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const entry = statSync(path);
    if (entry.isDirectory()) files.push(...filesUnder(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

/**
 * Installs the pinned story-skills skills into the skills library (ADR 0015
 * decision 6): each SKILL.md is created through SkillService with its
 * upstream text unchanged, and its references/ folder is copied beside it
 * for read_skill_file. A skill the user already has is not overwritten.
 * Reference files that a bundled install is missing (a copy that stopped
 * partway) are filled in; files already on disk are left as they are. If
 * copying fails, the skill created in that attempt is removed.
 */
export class StorySkillsInstaller {
  constructor(
    private readonly skills: SkillService,
    private readonly skillsRoot: string,
    private readonly sourceDir: string = resolveStorySkillsDir(),
  ) {}

  install(): StorySkillsInstallResult {
    const byName = new Map(this.skills.list().map((skill) => [skill.name, skill]));
    const installed: SkillMetadata[] = [];
    const skipped: string[] = [];
    for (const name of readdirSync(this.sourceDir).sort()) {
      const skillFile = join(this.sourceDir, name, 'SKILL.md');
      if (!existsSync(skillFile)) continue;
      const current = byName.get(name);
      if (current) {
        // A skill we installed that is missing pinned reference files (a copy
        // that stopped partway) is repaired. Existing files, including user
        // edits, are left alone, and a skill the user created is not touched.
        if (current.origin.type === 'bundled' && current.origin.starterId === name) {
          this.copyMissingReferences(name);
        }
        skipped.push(name);
        continue;
      }
      const parsed = matter(readFileSync(skillFile, 'utf8'));
      const data = parsed.data as { name?: unknown; description?: unknown };
      const description =
        typeof data.description === 'string' ? data.description.trim().slice(0, 1024) : name;
      let created: SkillMetadata | undefined;
      try {
        created = this.skills.create({
          name,
          description,
          content: parsed.content,
          license: 'MIT',
          origin: { type: 'bundled', starterId: name },
        });
        this.copyMissingReferences(name);
      } catch (error) {
        if (created) this.skills.delete(created.id);
        throw error;
      }
      installed.push(created);
    }
    return { installed, skipped };
  }

  /**
   * Copies pinned reference files that are not already on disk. Never
   * overwrites a file the user (or a previous install) already has.
   */
  private copyMissingReferences(name: string): void {
    const references = join(this.sourceDir, name, 'references');
    if (!existsSync(references)) return;
    const destination = join(this.skillsRoot, name, 'references');
    for (const file of filesUnder(references)) {
      const target = join(destination, relative(references, file));
      if (existsSync(target)) continue;
      mkdirSync(dirname(target), { recursive: true });
      cpSync(file, target);
    }
  }
}
