import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import matter from 'gray-matter';
import { describe, expect, it } from 'vitest';

const starterDir = fileURLToPath(new URL('../../skills-starter/', import.meta.url));

const EXPECTED_STARTERS = [
  'adaptation-synthesis',
  'belief-systems',
  'character-arc',
  'character-naming',
  'cliche-transcendence',
  'dialogue',
  'economic-systems',
  'endings',
  'game-facilitator',
  'genre-conventions',
  'governance-systems',
  'prose-style',
  'scene-sequencing',
  'settlement-design',
  'skill-creator',
  'story-idea-generator',
  'story-sense',
  'systemic-worldbuilding',
  'worldbuilding',
] as const;

// Diagnostic-first coaching language that generative skills must not lead with.
const DIAGNOSTIC_FIRST_PHRASES = [
  'your role is diagnostic',
  'the writer does the writing',
  'diagnose what is wrong',
  'provide feedback',
] as const;

// The bundled catalog spans several skill kinds, distinguished by their
// frontmatter `metadata.mode`. Each kind imposes its own section contract while
// sharing the gated `## Explicit Critique Mode` escape hatch.
type SkillKind = 'generative' | 'interactive' | 'authoring';

interface KindContract {
  type: string;
  requiredSections: readonly string[];
  checkDiagnosticPhrases: boolean;
}

const KIND_CONTRACTS: Record<SkillKind, KindContract> = {
  generative: {
    type: 'generator',
    requiredSections: [
      '## Creation Mode',
      '## Source-Ready Output Contract',
      '## Canon and Ambiguity',
      '## Explicit Critique Mode',
    ],
    checkDiagnosticPhrases: true,
  },
  interactive: {
    type: 'facilitator',
    requiredSections: [
      '## Facilitation Mode',
      '## Session Contract',
      '## Canon and Continuity',
      '## Explicit Critique Mode',
    ],
    checkDiagnosticPhrases: false,
  },
  authoring: {
    type: 'authoring',
    requiredSections: [
      '## Authoring Mode',
      '## SKILL.md Contract',
      '## Output Contract',
      '## Explicit Critique Mode',
    ],
    checkDiagnosticPhrases: false,
  },
};

// Intentionally partial: only recognized modes map to a kind; an unknown mode
// yields `undefined` and fails the test loudly.
const MODE_TO_KIND: Partial<Record<string, SkillKind>> = {
  'generative+explicit-critique': 'generative',
  interactive: 'interactive',
  authoring: 'authoring',
};

describe('bundled starter skill content', () => {
  it('contains exactly the curated starter set', () => {
    const starters = readdirSync(starterDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(starters).toEqual(EXPECTED_STARTERS);
  });

  it.each(EXPECTED_STARTERS)('%s satisfies its skill-kind contract', (starterId) => {
    const parsed = matter(
      readFileSync(new URL(`../../skills-starter/${starterId}/SKILL.md`, import.meta.url), 'utf8'),
    );

    expect(parsed.data.name).toBe(starterId);
    expect(parsed.data.license).toBe('MIT');

    const metadata = (parsed.data.metadata ?? {}) as { type?: unknown; mode?: unknown };
    const mode = typeof metadata.mode === 'string' ? metadata.mode : '';
    const kind = MODE_TO_KIND[mode];
    if (!kind) throw new Error(`${starterId} has an unrecognized skill mode "${mode}"`);
    const contract = KIND_CONTRACTS[kind];

    expect(metadata.type).toBe(contract.type);
    for (const section of contract.requiredSections) expect(parsed.content).toContain(section);

    if (contract.checkDiagnosticPhrases) {
      const creationInstructions = parsed.content.split('## Explicit Critique Mode')[0] ?? '';
      for (const phrase of DIAGNOSTIC_FIRST_PHRASES) {
        expect(creationInstructions.toLowerCase()).not.toContain(phrase);
      }
    }
  });
});
