import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, sep } from 'node:path';

import matter from 'gray-matter';
import { z } from 'zod';

import type { SkillMetadata, StorySkillsInstallResult } from '@worldbookllm/shared';

import { InvalidStoredDataError } from '../errors.js';
import type { SkillService } from '../services/skills.js';

const packageJson = createRequire(import.meta.url).resolve('story-skills/package.json');
const packageVersion = (JSON.parse(readFileSync(packageJson, 'utf8')) as { version?: unknown })
  .version;
if (typeof packageVersion !== 'string' || packageVersion.trim() === '') {
  throw new Error('The installed story-skills package has no version.');
}
const STORY_SKILLS_PACKAGE = `story-skills@${packageVersion}`;

/**
 * What an install wrote, kept beside SKILL.md so a later version can tell an
 * untouched install from one the writer edited. `skill` is the SKILL.md body
 * hash (null when the body was already edited), `references` maps each
 * untouched reference file to its hash.
 */
const BASELINE_FILE = '.story-skills.json';
const baselineSchema = z.object({
  package: z.string(),
  description: z.string(),
  skill: z.string().nullable(),
  references: z.record(z.string(), z.string()),
});
type Baseline = z.infer<typeof baselineSchema>;

/** The bundled story-skills package's skills folder. */
function resolveStorySkillsDir(): string {
  return join(dirname(packageJson), 'skills');
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

function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

interface UpstreamSkill {
  description: string;
  content: string;
  /** Skill-relative POSIX path (`references/…`) to its absolute source path. */
  references: Map<string, string>;
}

/**
 * Installs the bundled story-skills skills into the skills library (ADR 0015
 * decision 6) and keeps them current (ADR 0021). Each SKILL.md is created
 * through SkillService with its upstream text unchanged, and its references/
 * folder is copied beside it for read_skill_file. A skill the user created
 * is never touched.
 *
 * When the bundled package is newer than an install, the install is moved to
 * the new version only if the writer has not edited it (SKILL.md, its
 * description, and every installed reference file match what was installed).
 * An edited install is kept as it is and reported. Reference files that a
 * current install is missing (a copy that stopped partway) are filled in;
 * files already on disk are left as they are.
 */
export class StorySkillsInstaller {
  constructor(
    private readonly skills: SkillService,
    private readonly skillsRoot: string,
    private readonly sourceDir: string = resolveStorySkillsDir(),
    private readonly packageId: string = STORY_SKILLS_PACKAGE,
  ) {}

  /** Installs missing skills and refreshes existing installs. */
  install(): StorySkillsInstallResult {
    return this.sync(true);
  }

  /**
   * Refreshes existing installs only, without adding skills the writer has
   * not installed (or deleted). Runs at startup.
   */
  refresh(): StorySkillsInstallResult {
    return this.sync(false);
  }

  private sync(createMissing: boolean): StorySkillsInstallResult {
    const byName = new Map(this.skills.list().map((skill) => [skill.name, skill]));
    const result: StorySkillsInstallResult = { installed: [], skipped: [], upgraded: [], kept: [] };
    for (const name of readdirSync(this.sourceDir).sort()) {
      const skillFile = join(this.sourceDir, name, 'SKILL.md');
      if (!existsSync(skillFile)) continue;
      const current = byName.get(name);
      if (!current) {
        if (createMissing) result.installed.push(this.create(name));
        continue;
      }
      if (current.origin.type !== 'story-skills' || current.origin.skillId !== name) {
        result.skipped.push(name);
        continue;
      }
      try {
        if (current.origin.package === this.packageId) {
          this.repair(current);
          result.skipped.push(name);
        } else {
          const upgraded = this.upgrade(current);
          if (upgraded) result.upgraded.push(upgraded);
          else result.kept.push(name);
        }
      } catch (error) {
        // A SKILL.md that no longer parses is the writer's to fix; it does
        // not stop the other skills from installing or upgrading.
        if (!(error instanceof InvalidStoredDataError)) throw error;
        result.kept.push(name);
      }
    }
    return result;
  }

  private upstream(name: string): UpstreamSkill {
    const parsed = matter(readFileSync(join(this.sourceDir, name, 'SKILL.md'), 'utf8'));
    const data = parsed.data as { description?: unknown };
    const description =
      typeof data.description === 'string' ? data.description.trim().slice(0, 1024) : name;
    const references = new Map<string, string>();
    const dir = join(this.sourceDir, name, 'references');
    if (existsSync(dir)) {
      for (const file of filesUnder(dir)) {
        references.set(`references/${relative(dir, file).split(sep).join('/')}`, file);
      }
    }
    return { description, content: parsed.content, references };
  }

  private create(name: string): SkillMetadata {
    const upstream = this.upstream(name);
    let created: SkillMetadata | undefined;
    try {
      created = this.skills.create({
        name,
        description: upstream.description,
        content: upstream.content,
        license: 'MIT',
        origin: { type: 'story-skills', package: this.packageId, skillId: name },
      });
      this.copyMissingReferences(name, upstream);
      this.writeBaseline(name, {
        package: this.packageId,
        description: created.description,
        skill: created.contentHash,
        references: this.untouchedReferences(name, upstream),
      });
    } catch (error) {
      if (created) this.skills.delete(created.id);
      throw error;
    }
    return created;
  }

  /**
   * Fills in missing reference files of a current install and records its
   * baseline if it has none (installs from before baselines existed): only
   * what still matches upstream counts as untouched.
   */
  private repair(skill: SkillMetadata): void {
    const upstream = this.upstream(skill.name);
    this.copyMissingReferences(skill.name, upstream);
    const baseline = this.readBaseline(skill.name);
    if (baseline?.package === this.packageId) {
      const references = { ...this.untouchedReferences(skill.name, upstream) };
      for (const [path, hash] of Object.entries(baseline.references)) {
        if (!(path in references)) references[path] = hash;
      }
      this.writeBaseline(skill.name, { ...baseline, references });
      return;
    }
    const detail = this.skills.get(skill.id);
    const untouched =
      detail.description === upstream.description &&
      detail.content.trim() === upstream.content.trim();
    this.writeBaseline(skill.name, {
      package: this.packageId,
      description: detail.description,
      skill: untouched ? detail.contentHash : null,
      references: this.untouchedReferences(skill.name, upstream),
    });
  }

  /** Moves an unedited install to the bundled version; null when it was edited. */
  private upgrade(skill: SkillMetadata): SkillMetadata | null {
    if (skill.origin.type !== 'story-skills') return null;
    const baseline = this.readBaseline(skill.name);
    if (!baseline || baseline.package !== skill.origin.package || baseline.skill === null) {
      return null;
    }
    const detail = this.skills.get(skill.id);
    if (detail.contentHash !== baseline.skill || detail.description !== baseline.description) {
      return null;
    }
    const root = join(this.skillsRoot, skill.name);
    for (const [path, hash] of Object.entries(baseline.references)) {
      const target = join(root, path);
      if (existsSync(target) && hashFile(target) !== hash) return null;
    }

    const upstream = this.upstream(skill.name);
    const upgraded = this.skills.replaceInstalled(skill.id, {
      description: upstream.description,
      content: upstream.content,
      origin: { ...skill.origin, package: this.packageId },
    });
    // Untouched files from the old version are replaced or, when upstream
    // dropped them, removed. Files the writer added are left alone.
    for (const path of Object.keys(baseline.references)) {
      if (!upstream.references.has(path)) rmSync(join(root, path), { force: true });
    }
    for (const [path, source] of upstream.references) {
      const target = join(root, path);
      if (existsSync(target) && !(path in baseline.references)) continue;
      mkdirSync(dirname(target), { recursive: true });
      cpSync(source, target);
    }
    this.writeBaseline(skill.name, {
      package: this.packageId,
      description: upgraded.description,
      skill: upgraded.contentHash,
      references: this.untouchedReferences(skill.name, upstream),
    });
    return upgraded;
  }

  /**
   * Copies reference files that are not already on disk. Never overwrites a
   * file the user (or a previous install) already has.
   */
  private copyMissingReferences(name: string, upstream: UpstreamSkill): void {
    for (const [path, source] of upstream.references) {
      const target = join(this.skillsRoot, name, path);
      if (existsSync(target)) continue;
      mkdirSync(dirname(target), { recursive: true });
      cpSync(source, target);
    }
  }

  /** The installed reference files that match upstream byte for byte. */
  private untouchedReferences(name: string, upstream: UpstreamSkill): Record<string, string> {
    const references: Record<string, string> = {};
    for (const [path, source] of upstream.references) {
      const target = join(this.skillsRoot, name, path);
      if (!existsSync(target)) continue;
      const hash = hashFile(target);
      if (hash === hashFile(source)) references[path] = hash;
    }
    return references;
  }

  private readBaseline(name: string): Baseline | null {
    const path = join(this.skillsRoot, name, BASELINE_FILE);
    if (!existsSync(path)) return null;
    try {
      return baselineSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    } catch {
      return null;
    }
  }

  private writeBaseline(name: string, baseline: Baseline): void {
    const path = join(this.skillsRoot, name, BASELINE_FILE);
    const text = `${JSON.stringify(baseline, null, 2)}\n`;
    if (existsSync(path) && readFileSync(path, 'utf8') === text) return;
    writeFileSync(path, text);
  }
}
