import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import matter from 'gray-matter';
import { describe, expect, it } from 'vitest';

const starterDir = fileURLToPath(new URL('../../skills-starter/', import.meta.url));

const EXPECTED_STARTERS = [
  'belief-systems',
  'character-arc',
  'character-naming',
  'cliche-transcendence',
  'dialogue',
  'economic-systems',
  'endings',
  'genre-conventions',
  'governance-systems',
  'prose-style',
  'scene-sequencing',
  'settlement-design',
  'story-idea-generator',
  'story-sense',
  'systemic-worldbuilding',
  'worldbuilding',
] as const;

const REQUIRED_SECTIONS = [
  '## Creation Mode',
  '## Source-Ready Output Contract',
  '## Canon and Ambiguity',
  '## Explicit Critique Mode',
] as const;

const DIAGNOSTIC_FIRST_PHRASES = [
  'your role is diagnostic',
  'the writer does the writing',
  'diagnose what is wrong',
  'provide feedback',
] as const;

describe('bundled starter skill content', () => {
  it('contains exactly the curated starter set', () => {
    const starters = readdirSync(starterDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(starters).toEqual(EXPECTED_STARTERS);
  });

  it.each(EXPECTED_STARTERS)('%s is a generative-first, source-ready skill', (starterId) => {
    const parsed = matter(
      readFileSync(new URL(`../../skills-starter/${starterId}/SKILL.md`, import.meta.url), 'utf8'),
    );

    expect(parsed.data.name).toBe(starterId);
    expect(parsed.data.license).toBe('MIT');
    expect(parsed.data.metadata).toMatchObject({
      type: 'generator',
      mode: 'generative+explicit-critique',
    });

    for (const section of REQUIRED_SECTIONS) expect(parsed.content).toContain(section);

    const creationInstructions = parsed.content.split('## Explicit Critique Mode')[0] ?? '';
    for (const phrase of DIAGNOSTIC_FIRST_PHRASES) {
      expect(creationInstructions.toLowerCase()).not.toContain(phrase);
    }
  });
});
