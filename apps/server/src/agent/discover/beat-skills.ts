import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { BeatWriterInstallResult, StorySkillsInstallResult } from '@worldbookllm/shared';

import type { SkillService } from '../../services/skills.js';
import type { CustomAgentService } from '../custom-agents.js';
import { StorySkillsInstaller } from '../story-skills-installer.js';

/**
 * The version of the skills in apps/server/beat-skills. Bump it whenever a
 * file there changes, so unedited installs move to the new text; a test
 * keeps the two in step.
 */
export const BEAT_SKILLS_PACKAGE = 'beat-skills@1.1.0';

/** The agent the install makes, which names every beat writer skill. */
const BEAT_WRITER_AGENT = {
  name: 'Beat writer',
  description: 'Writes discovery beats with the beat writer skills.',
  instructions:
    'Write each beat so the book reads as one story, and follow your skills on every beat: beat-shape for the prose, choice-design for the choices, memory-and-state and branch-economy for where they lead, voice-continuity throughout, and reader-actions when the reader types their own action.',
};

/** apps/server/beat-skills, from src/agent/discover in development or dist/ when built. */
export function beatSkillsDir(): string {
  for (const relative of ['../../../beat-skills', '../beat-skills']) {
    const dir = fileURLToPath(new URL(relative, import.meta.url));
    if (existsSync(dir)) return dir;
  }
  throw new Error('The beat writer skills folder (apps/server/beat-skills) is missing.');
}

/**
 * worldbookllm's own skills for the discovery beat writer (ADR 0034),
 * installed and kept current like Story Skills.
 */
export class BeatWriterSkills {
  private readonly installer: StorySkillsInstaller;

  constructor(
    skills: SkillService,
    private readonly agents: CustomAgentService,
    skillsRoot: string,
    sourceDir: string = beatSkillsDir(),
  ) {
    this.installer = new StorySkillsInstaller(skills, skillsRoot, sourceDir, BEAT_SKILLS_PACKAGE);
  }

  /**
   * Installs the skills and makes the Beat writer agent if there is none. An
   * agent of that name the writer already has is left as they made it.
   */
  install(): BeatWriterInstallResult {
    const skills = this.installer.install();
    // Every skill in the folder lands in exactly one of these lists.
    const names = [...skills.installed, ...skills.upgraded]
      .map((skill) => skill.name)
      .concat(skills.skipped, skills.kept)
      .sort();
    const agent =
      this.agents.list().find((entry) => entry.name === BEAT_WRITER_AGENT.name) ??
      this.agents.create({ ...BEAT_WRITER_AGENT, skills: names });
    return { agent, skills };
  }

  /** Moves unedited installs to this version; adds nothing. Runs at startup. */
  refresh(): StorySkillsInstallResult {
    return this.installer.refresh();
  }
}
