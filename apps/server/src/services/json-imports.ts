import { z } from 'zod';

import type { JsonImportPreview } from '@worldbookllm/shared';

import { InvalidImportError } from '../errors.js';

const MAX_JSON_BYTES = 5 * 1024 * 1024;
const MAX_ENTRIES = 1_000;

const recordSchema = z.record(z.string(), z.unknown());
const loreEntrySchema = z.looseObject({
  comment: z.string().optional(),
  content: z.string(),
  key: z.array(z.string()).optional(),
  keys: z.array(z.string()).optional(),
});

function asRecord(value: unknown): Record<string, unknown> | undefined {
  const parsed = recordSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function cleanTitle(value: string | undefined, fallback: string): string {
  const title = value?.trim() || fallback;
  return title.slice(0, 300);
}

function parseLorebook(root: Record<string, unknown>, fileName: string): JsonImportPreview | null {
  const rawEntries = root.entries;
  const values = Array.isArray(rawEntries)
    ? rawEntries
    : asRecord(rawEntries) === undefined
      ? null
      : Object.values(asRecord(rawEntries) ?? {});
  if (values === null) return null;
  if (values.length > MAX_ENTRIES) {
    throw new InvalidImportError(`Lorebook exceeds ${MAX_ENTRIES} entries.`);
  }

  const entries = values.flatMap((value, index) => {
    const parsed = loreEntrySchema.safeParse(value);
    if (!parsed.success || parsed.data.content.trim() === '') return [];
    const keys = parsed.data.key ?? parsed.data.keys ?? [];
    return [
      {
        title: cleanTitle(
          parsed.data.comment,
          keys.find((key) => key.trim() !== '') ?? `Entry ${index + 1}`,
        ),
        markdown: parsed.data.content,
      },
    ];
  });
  if (entries.length === 0) {
    throw new InvalidImportError('The lorebook has no entries with content.');
  }

  return {
    format: 'lorebook',
    fileName,
    entries,
    conversionNotes: [
      'Imported entry content only; SillyTavern activation keys and settings were omitted.',
    ],
  };
}

const CHARACTER_FIELDS = [
  ['description', 'Description'],
  ['personality', 'Personality'],
  ['scenario', 'Scenario'],
  ['first_mes', 'First Message'],
  ['mes_example', 'Example Dialogue'],
  ['system_prompt', 'System Prompt'],
  ['post_history_instructions', 'Post-History Instructions'],
] as const;

function parseCharacter(root: Record<string, unknown>, fileName: string): JsonImportPreview | null {
  const nested = asRecord(root.data);
  const hasNestedCharacter =
    typeof nested?.name === 'string' &&
    CHARACTER_FIELDS.some(([field]) => typeof nested[field] === 'string');
  const isVersioned =
    root.spec === 'chara_card_v2' || root.spec === 'chara_card_v3' || hasNestedCharacter;
  const isLegacy = [
    'name',
    'description',
    'personality',
    'scenario',
    'first_mes',
    'mes_example',
  ].every((field) => typeof root[field] === 'string');
  const isPygmalion = typeof root.char_name === 'string';
  if (!isVersioned && !isLegacy && !isPygmalion) return null;

  const data = nested ?? root;
  const nameValue = isPygmalion ? root.char_name : data.name;
  if (typeof nameValue !== 'string' || nameValue.trim() === '') {
    throw new InvalidImportError('The character card is missing a character name.');
  }

  const normalized = isPygmalion
    ? {
        description: root.char_persona,
        scenario: root.world_scenario,
        first_mes: root.char_greeting,
        mes_example: root.example_dialogue,
      }
    : data;
  const sections: string[] = [`# ${nameValue.trim()}`];
  for (const [field, heading] of CHARACTER_FIELDS) {
    const value = normalized[field];
    if (typeof value === 'string' && value.trim() !== '') {
      sections.push(`## ${heading}\n\n${value}`);
    }
  }

  const alternateGreetings = normalized.alternate_greetings;
  if (Array.isArray(alternateGreetings)) {
    const greetings = alternateGreetings.filter(
      (value): value is string => typeof value === 'string' && value.trim() !== '',
    );
    if (greetings.length > 0) {
      sections.push(
        `## Alternate Greetings\n\n${greetings
          .map((greeting, index) => `### Greeting ${index + 1}\n\n${greeting}`)
          .join('\n\n')}`,
      );
    }
  }

  const extensions = asRecord(normalized.extensions);
  const depthPrompt = asRecord(extensions?.depth_prompt);
  if (typeof depthPrompt?.prompt === 'string' && depthPrompt.prompt.trim() !== '') {
    sections.push(`## Character Note\n\n${depthPrompt.prompt}`);
  }

  return {
    format: 'character',
    fileName,
    entries: [{ title: cleanTitle(nameValue, 'Character'), markdown: sections.join('\n\n') }],
    conversionNotes: [
      'Imported character context only; card specification, creator, tags, and extension metadata were omitted.',
    ],
  };
}

export function previewSillyTavernJson(bytes: Buffer, fileName: string): JsonImportPreview {
  if (bytes.byteLength === 0) throw new InvalidImportError('The uploaded JSON file is empty.');
  if (bytes.byteLength > MAX_JSON_BYTES) {
    throw new InvalidImportError('The uploaded JSON file exceeds 5 MiB.');
  }

  let value: unknown;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    value = JSON.parse(text);
  } catch {
    throw new InvalidImportError('The uploaded file is not valid UTF-8 JSON.');
  }

  const root = asRecord(value);
  if (root === undefined) {
    throw new InvalidImportError('The uploaded JSON must contain an object.');
  }

  const character = parseCharacter(root, fileName);
  if (character !== null) return character;
  const lorebook = parseLorebook(root, fileName);
  if (lorebook !== null) return lorebook;
  throw new InvalidImportError(
    'The JSON is not a supported SillyTavern lorebook or character card.',
  );
}
