import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';

import {
  createCustomAgentSchema,
  type CreateCustomAgentInput,
  type CustomAgent,
  type PatchCustomAgentInput,
} from '@worldbookllm/shared';

import { InvalidStoredDataError, NotFoundError, ValidationError } from '../errors.js';
import type { SkillService } from '../services/skills.js';

interface CustomAgentRow {
  id: string;
  name: string;
  description: string;
  instructions: string;
  skills_json: string;
  created_at: string;
  updated_at: string;
}

function toAgent(row: CustomAgentRow): CustomAgent {
  let skills: unknown;
  try {
    skills = JSON.parse(row.skills_json);
  } catch (error) {
    throw new InvalidStoredDataError(`Agent ${row.id} has invalid stored skills`, { cause: error });
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    skills: Array.isArray(skills) ? (skills as string[]) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Saved custom agents: a name, standing instructions added to the agent's
 * system prompt, and the installed skills it may use (all of them when
 * `skills` is null). Chats pick one when they start; deleting an agent
 * returns its chats to the default agent.
 */
export class CustomAgentService {
  constructor(
    private readonly db: Database.Database,
    private readonly skills: SkillService,
  ) {}

  list(): CustomAgent[] {
    return (
      this.db
        .prepare('SELECT * FROM custom_agents ORDER BY name COLLATE NOCASE, id')
        .all() as CustomAgentRow[]
    ).map(toAgent);
  }

  get(id: string): CustomAgent {
    const row = this.db.prepare('SELECT * FROM custom_agents WHERE id = ?').get(id) as
      CustomAgentRow | undefined;
    if (!row) throw new NotFoundError(`Agent ${id} was not found`);
    return toAgent(row);
  }

  create(input: CreateCustomAgentInput): CustomAgent {
    const parsed = createCustomAgentSchema.parse(input);
    this.assertSkillsExist(parsed.skills);
    const now = new Date().toISOString();
    const row: CustomAgentRow = {
      id: randomUUID(),
      name: parsed.name,
      description: parsed.description,
      instructions: parsed.instructions,
      skills_json: JSON.stringify(parsed.skills),
      created_at: now,
      updated_at: now,
    };
    this.db
      .prepare(
        `INSERT INTO custom_agents (id, name, description, instructions, skills_json, created_at, updated_at)
         VALUES (@id, @name, @description, @instructions, @skills_json, @created_at, @updated_at)`,
      )
      .run(row);
    return toAgent(row);
  }

  patch(id: string, input: PatchCustomAgentInput): CustomAgent {
    const current = this.get(id);
    if (input.skills !== undefined) this.assertSkillsExist(input.skills);
    const next = {
      name: input.name ?? current.name,
      description: input.description ?? current.description,
      instructions: input.instructions ?? current.instructions,
      skills: input.skills === undefined ? current.skills : input.skills,
    };
    this.db
      .prepare(
        'UPDATE custom_agents SET name = ?, description = ?, instructions = ?, skills_json = ?, updated_at = ? WHERE id = ?',
      )
      .run(
        next.name,
        next.description,
        next.instructions,
        JSON.stringify(next.skills),
        new Date().toISOString(),
        id,
      );
    return this.get(id);
  }

  delete(id: string): void {
    this.get(id);
    this.db.prepare('DELETE FROM custom_agents WHERE id = ?').run(id);
  }

  private assertSkillsExist(skills: readonly string[] | null): void {
    if (skills === null) return;
    const installed = new Set(this.skills.list().map((skill) => skill.name));
    const missing = skills.filter((name) => !installed.has(name));
    if (missing.length > 0) {
      throw new ValidationError(`These skills are not installed: ${missing.join(', ')}`);
    }
  }
}
