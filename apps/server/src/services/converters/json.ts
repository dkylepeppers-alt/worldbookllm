import { z } from 'zod';

import { InvalidImportError } from '../../errors.js';
import { MAX_ENTRIES } from './limits.js';
import type { ConversionResult, PreviewEntry } from './types.js';
import { cleanTitle, fileStem } from './text-utils.js';

const JSON_MEDIA_TYPE = 'application/json';
const MIN_GENERIC_STRING_LENGTH = 80;

const recordSchema = z.record(z.string(), z.unknown());

function asRecord(value: unknown): Record<string, unknown> | undefined {
  const parsed = recordSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function firstString(
  record: Record<string, unknown>,
  fields: readonly string[],
): string | undefined {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return undefined;
}

// --- Lorebook (loosely matched) ---

const LORE_CONTENT_FIELDS = ['content', 'text', 'entry', 'value'] as const;
const LORE_TITLE_FIELDS = ['comment', 'title', 'name', 'displayName'] as const;

function loreEntryValues(root: unknown): unknown[] | null {
  if (Array.isArray(root)) return root;
  const record = asRecord(root);
  if (record === undefined) return null;
  const containers = [
    record.entries,
    asRecord(record.data)?.entries,
    asRecord(record.lorebook)?.entries,
    asRecord(record.character_book)?.entries,
  ];
  for (const container of containers) {
    if (Array.isArray(container)) return container;
    const asMap = asRecord(container);
    if (asMap !== undefined) return Object.values(asMap);
  }
  return null;
}

function firstKey(record: Record<string, unknown>): string | undefined {
  for (const field of ['key', 'keys']) {
    const value = record[field];
    if (Array.isArray(value)) {
      const found = value.find((item) => typeof item === 'string' && item.trim() !== '');
      if (typeof found === 'string') return found;
    }
  }
  return undefined;
}

function parseLorebook(values: unknown[], fileName: string): ConversionResult | null {
  if (values.length > MAX_ENTRIES) {
    throw new InvalidImportError(`The lorebook exceeds ${MAX_ENTRIES} entries.`);
  }
  const entries: PreviewEntry[] = values.flatMap((value, index) => {
    const record = asRecord(value);
    if (record === undefined) return [];
    const content = firstString(record, LORE_CONTENT_FIELDS);
    if (content === undefined) return [];
    return [
      {
        title: cleanTitle(
          firstString(record, LORE_TITLE_FIELDS) ?? firstKey(record),
          `${fileStem(fileName)} · Entry ${index + 1}`,
        ),
        markdown: content,
      },
    ];
  });
  if (entries.length === 0) return null;
  return {
    format: 'lorebook',
    mediaType: JSON_MEDIA_TYPE,
    entries,
    conversionNotes: [
      'Imported entry content only; SillyTavern activation keys and settings were omitted.',
    ],
  };
}

// --- Character card ---

const CHARACTER_FIELDS = [
  ['description', 'Description'],
  ['personality', 'Personality'],
  ['scenario', 'Scenario'],
  ['first_mes', 'First Message'],
  ['mes_example', 'Example Dialogue'],
  ['system_prompt', 'System Prompt'],
  ['post_history_instructions', 'Post-History Instructions'],
] as const;

function parseCharacter(root: Record<string, unknown>): ConversionResult | null {
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
    mediaType: JSON_MEDIA_TYPE,
    entries: [{ title: cleanTitle(nameValue, 'Character'), markdown: sections.join('\n\n') }],
    conversionNotes: [
      'Imported character context only; card specification, creator, tags, and extension metadata were omitted.',
    ],
  };
}

// --- Generic fallback (never rejects structurally valid JSON) ---

function collectStrings(
  value: unknown,
  path: string,
  out: { path: string; value: string }[],
): void {
  if (typeof value === 'string') {
    if (value.trim().length >= MIN_GENERIC_STRING_LENGTH) out.push({ path, value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectStrings(item, `${path}[${index}]`, out));
    return;
  }
  const record = asRecord(value);
  if (record === undefined) return;
  for (const [key, item] of Object.entries(record)) {
    collectStrings(item, path === '' ? key : `${path}.${key}`, out);
  }
}

function convertGenericJson(value: unknown, fileName: string): ConversionResult {
  const collected: { path: string; value: string }[] = [];
  collectStrings(value, '', collected);
  const markdown =
    collected.length > 0
      ? collected.map(({ path, value: text }) => `## ${path}\n\n${text}`).join('\n\n')
      : `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
  return {
    format: 'json',
    mediaType: JSON_MEDIA_TYPE,
    entries: [{ title: cleanTitle(undefined, fileStem(fileName)), markdown }],
    conversionNotes: [
      'No known lorebook or character card structure was detected; imported the JSON content as-is.',
    ],
  };
}

/**
 * Converts JSON to a preview. SillyTavern character cards and lorebooks (matched
 * loosely, tolerant of schema variants) get focused conversions; any other
 * structurally valid JSON falls back to a best-effort generic conversion rather
 * than being rejected. Only unparseable JSON throws.
 */
export function convertJson(text: string, fileName: string): ConversionResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new InvalidImportError('The file is not valid JSON.');
  }

  const root = asRecord(value);
  if (root !== undefined) {
    const character = parseCharacter(root);
    if (character !== null) return character;
  }

  const values = loreEntryValues(value);
  if (values !== null) {
    const lorebook = parseLorebook(values, fileName);
    if (lorebook !== null) return lorebook;
  }

  return convertGenericJson(value, fileName);
}
