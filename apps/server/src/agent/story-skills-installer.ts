import { cpSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

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

/**
 * Installs the pinned story-skills skills into the skills library (ADR 0015
 * decision 6): each SKILL.md is created through SkillService with its
 * upstream text unchanged, and its references/ folder is copied beside it
 * for read_skill_file. Skills whose name is already installed are left
 * alone, including edited copies.
 */
export class StorySkillsInstaller {
  constructor(
    private readonly skills: SkillService,
    private readonly skillsRoot: string,
    private readonly sourceDir: string = resolveStorySkillsDir(),
  ) {}

  install(): StorySkillsInstallResult {
    const existing = new Set(this.skills.list().map((skill) => skill.name));
    const installed: SkillMetadata[] = [];
    const skipped: string[] = [];
    for (const name of readdirSync(this.sourceDir).sort()) {
      const skillFile = join(this.sourceDir, name, 'SKILL.md');
      if (!existsSync(skillFile)) continue;
      if (existing.has(name)) {
        skipped.push(name);
        continue;
      }
      const parsed = matter(readFileSync(skillFile, 'utf8'));
      const data = parsed.data as { name?: unknown; description?: unknown };
      const description =
        typeof data.description === 'string' ? data.description.trim().slice(0, 1024) : name;
      const skill = this.skills.create({
        name,
        description,
        content: parsed.content,
        license: 'MIT',
        origin: { type: 'bundled', starterId: name },
      });
      const references = join(this.sourceDir, name, 'references');
      if (existsSync(references)) {
        cpSync(references, join(this.skillsRoot, name, 'references'), { recursive: true });
      }
      installed.push(skill);
    }
    return { installed, skipped };
  }
}
