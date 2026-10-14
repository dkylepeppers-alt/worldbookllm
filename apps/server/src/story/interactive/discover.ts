import { createHash } from 'node:crypto';

import {
  discoverVariableSchema,
  type ClosingChoice,
  type DiscoverBeat,
  type DiscoverSetup,
  type DiscoverVariable,
  type StoryNode,
} from '@worldbookllm/shared';

import { parseFrontmatter } from '../book-index.js';
import { removeFrontmatterField, setFrontmatterField } from '../frontmatter-edit.js';
import { choiceLines, readEnding } from './ending.js';
import { inkKnotName, inkSection, orderChapters } from './format.js';

/**
 * The files discovery reads and writes (ADR 0033): the story setup, the
 * choice rules, the story kernel in story.md, the meaning of each variable
 * in `ink/variables.md`, and the frontmatter and layout of seed chapters and
 * written beats. Everything here is text in, text out; the book service
 * writes it.
 */

export const SETUP_FILE = 'adaptations/interactive/setup.md';
export const RULES_FILE = 'adaptations/interactive/choice-rules.md';

/** The rules every set of choices follows unless the writer changes them. */
export const DEFAULT_CHOICE_RULES = [
  '1. **Different intents, not different wording.** Each choice is a different approach: act, talk, hold back, a different value or risk. Two choices that only reword the same action are one choice.',
  '2. **True to the character.** Each choice is something this character, as the bible describes them, could plausibly do now.',
  '3. **Possible in the scene.** A choice uses only people, objects, and facts that are present or already established, and only what the character knows on this path.',
  '4. **Every choice matters.** Each leads somewhere different, sets a variable, or rejoins a shared beat that reads differently because of it. No choice changes nothing.',
  '5. **No obvious right answer.** Each option has a real cost or a real appeal, unless the scene is meant as a trap or a test.',
  '6. **No spoilers.** The choice says what the character does, not what happens.',
  '7. **Variety across the book.** Rotate the kinds of decision (moral, tactical, social, personal) so the book does not ask the same question twice in a row.',
  '8. **The book\'s voice.** Short and parallel in length, written as what the reader does, in the book\'s person but as an action, not narration ("Open the letter", not "She opened the letter").',
].join('\n');

const INK_RESERVED = new Set(['true', 'false', 'not', 'and', 'or', 'temp', 'return']);

/**
 * A variable as a model described it, made into one ink can declare, or
 * null when there is nothing to make one from. Names lose what ink cannot
 * use (`trust-mara` becomes `trust_mara`), starting values may be numbers or
 * booleans, a bare word is quoted, and the meaning is put on one line.
 */
export function looseVariable(raw: unknown): DiscoverVariable | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const entry = raw as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  let name = text(entry.name)
    .replace(/[^A-Za-z0-9_]+/gu, '_')
    .replace(/_+/gu, '_')
    .replace(/^_|_$/gu, '');
  if (name === '') return null;
  if (/^\d/u.test(name)) name = `v_${name}`;
  if (INK_RESERVED.has(name)) name = `${name}_`;
  const start = entry.initial ?? entry.value ?? entry.default ?? entry.start;
  let initial: string;
  if (typeof start === 'number' && Number.isFinite(start)) initial = String(start);
  else if (typeof start === 'boolean') initial = String(start);
  else if (typeof start === 'string' && start.trim() !== '') {
    const value = start.trim();
    if (/^(?:true|false)$/iu.test(value)) initial = value.toLowerCase();
    else if (/^-?\d+(?:\.\d+)?$/u.test(value) || /^"(?:[^"\\\r\n]|\\.)*"$/u.test(value)) {
      initial = value;
    } else initial = JSON.stringify(value.replace(/^"|"$/gu, '').replace(/\s+/gu, ' '));
  } else initial = '0';
  const meaning = text(entry.meaning || entry.description)
    .replace(/\s+/gu, ' ')
    .slice(0, 300)
    .trim();
  const parsed = discoverVariableSchema.safeParse({ name, initial, meaning });
  return parsed.success ? parsed.data : null;
}

/** A short hash of ink, ignoring trailing whitespace on lines and at the end. */
export function inkHash(ink: string): string {
  const normalized = ink
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

function stringField(frontmatter: Record<string, unknown> | null, key: string): string | null {
  const value = frontmatter?.[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** A Markdown section's text: from its `## Heading` line to the next `##` heading. */
function section(body: string, heading: string): string | null {
  const lines = body.replace(/\r\n?/gu, '\n').split('\n');
  const at = lines.findIndex((line) => new RegExp(`^##\\s+${heading}\\s*$`, 'iu').test(line));
  if (at === -1) return null;
  const end = lines.findIndex((line, index) => index > at && /^#{1,2}\s/u.test(line));
  return lines
    .slice(at + 1, end === -1 ? undefined : end)
    .join('\n')
    .trim();
}

/**
 * The writer's text made safe to keep in a `## Heading` section: its own
 * `#` and `##` headings become `###`, so reading the section back does not
 * stop at them.
 */
function sectionText(text: string): string {
  return text.trim().replace(/^#{1,2}(?=\s)/gmu, '###');
}

/** The body with a `## Heading` section's text replaced, or the section added at the end. */
function withSection(text: string, heading: string, content: string): string {
  const lines = text.replace(/\r\n?/gu, '\n').split('\n');
  const at = lines.findIndex((line) => new RegExp(`^##\\s+${heading}\\s*$`, 'iu').test(line));
  const block = [`## ${heading}`, '', ...(content.trim() === '' ? [] : [sectionText(content), ''])];
  if (at === -1) {
    return `${text.trimEnd()}\n\n${block.join('\n').trimEnd()}\n`;
  }
  const end = lines.findIndex((line, index) => index > at && /^#{1,2}\s/u.test(line));
  const after = end === -1 ? [] : lines.slice(end);
  return [...lines.slice(0, at), ...block, ...after].join('\n').trimEnd().concat('\n');
}

const MODES = new Set(['lead', 'cowrite']);
const LENGTHS = new Set(['scene', 'chapter']);
const REJOINS = new Set(['often', 'sometimes', 'rarely']);

/** The setup recorded in setup.md and story.md, or null when the book has none. */
export function readSetup(setupText: string | null, storyText: string): DiscoverSetup | null {
  if (setupText === null) return null;
  const { frontmatter, body } = parseFrontmatter(setupText);
  const mode = stringField(frontmatter, 'discover-mode');
  const length = stringField(frontmatter, 'beat-length');
  const rejoin = stringField(frontmatter, 'rejoin');
  const lookahead = Number(frontmatter?.lookahead);
  const choices = Number(frontmatter?.choices);
  return {
    mode: mode !== null && MODES.has(mode) ? (mode as DiscoverSetup['mode']) : 'lead',
    lookahead: lookahead === 2 ? 2 : 1,
    choices: Number.isInteger(choices) && choices >= 2 && choices <= 4 ? choices : 3,
    beatLength:
      length !== null && LENGTHS.has(length) ? (length as DiscoverSetup['beatLength']) : 'scene',
    rejoin:
      rejoin !== null && REJOINS.has(rejoin) ? (rejoin as DiscoverSetup['rejoin']) : 'sometimes',
    endings: stringField(frontmatter, 'endings') ?? '',
    kernel: readKernel(storyText),
    shape: section(body, 'Shape') ?? '',
    agentId: uuidField(frontmatter, 'beat-agent'),
  };
}

function uuidField(frontmatter: Record<string, unknown> | null, key: string): string | null {
  const value = stringField(frontmatter, key);
  return value !== null && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(value)
    ? value.toLowerCase()
    : null;
}

/** setup.md for a setup. Its values are JSON strings, which YAML reads as written. */
export function setupFile(setup: DiscoverSetup): string {
  return [
    '---',
    'title: "Story setup"',
    `discover-mode: "${setup.mode}"`,
    `lookahead: ${setup.lookahead}`,
    `choices: ${setup.choices}`,
    `beat-length: "${setup.beatLength}"`,
    `rejoin: "${setup.rejoin}"`,
    `endings: ${JSON.stringify(setup.endings)}`,
    ...(setup.agentId === null ? [] : [`beat-agent: ${JSON.stringify(setup.agentId)}`]),
    '---',
    '',
    '# Story setup',
    '',
    'How this interactive book is discovered by playing it (worldbookllm, ADR 0033). The premise is the story kernel in story.md, the variables and what they mean are in ink/variables.md, and the rules for choices are in choice-rules.md.',
    '',
    '## Shape',
    '',
    ...(setup.shape.trim() === '' ? [] : [sectionText(setup.shape), '']),
  ].join('\n');
}

export function rulesFile(rules: string): string {
  return ['---', 'title: "Choice rules"', '---', '', '# Choice rules', '', rules.trim(), ''].join(
    '\n',
  );
}

/** The rules as choice-rules.md holds them, without its frontmatter and heading. */
export function readRules(rulesText: string | null): string {
  if (rulesText === null) return DEFAULT_CHOICE_RULES;
  const body = parseFrontmatter(rulesText).body.replace(/^\s*#\s+Choice rules\s*\n/iu, '');
  return body.trim() === '' ? DEFAULT_CHOICE_RULES : body.trim();
}

/** story-skills' story kernel: the `## Story Kernel` section of story.md. */
export function readKernel(storyText: string): string {
  return section(parseFrontmatter(storyText).body, 'Story Kernel') ?? '';
}

/** story.md with the kernel written and `draft-mode: discovered`, as discovery-drafting has it. */
export function withKernel(storyText: string, kernel: string): string {
  return withSection(
    setFrontmatterField(storyText, 'draft-mode', 'discovered'),
    'Story Kernel',
    kernel,
  );
}

const VAR_LINE = /^\s*VAR\s+([A-Za-z_]\w*)\s*=\s*(.+?)\s*$/u;
const COMMENT_LINE = /^\s*\/\/\s?(.*)$/u;
// A literal a VAR starts with: a number, true or false, or quoted text (which may hold //).
const LITERAL = /^(?:-?\d+(?:\.\d+)?|true|false|"(?:[^"\\]|\\.)*")/u;

/** A VAR's starting value, without a comment after it; a quoted // stays. */
function initialOf(value: string): string {
  return LITERAL.exec(value)?.[0] ?? value.replace(/\s*\/\/.*$/u, '');
}

/** The `VAR`s of `ink/variables.md`, each with the `//` comment above it as its meaning. */
export function readVariables(variablesText: string | null): DiscoverVariable[] {
  if (variablesText === null) return [];
  const lines = inkSection(variablesText, 'ink').ink.split('\n');
  const variables: DiscoverVariable[] = [];
  lines.forEach((line, index) => {
    const match = VAR_LINE.exec(line);
    if (match === null) return;
    const comment = index > 0 ? COMMENT_LINE.exec(lines[index - 1]!) : null;
    variables.push({
      name: match[1]!,
      initial: initialOf(match[2]!),
      meaning: comment?.[1]?.trim() ?? '',
    });
  });
  return variables;
}

function declaration(variable: DiscoverVariable): string[] {
  return [
    ...(variable.meaning.trim() === '' ? [] : [`// ${variable.meaning.trim()}`]),
    `VAR ${variable.name} = ${variable.initial}`,
  ];
}

/**
 * `ink/variables.md` declaring exactly `variables`: each one already there is
 * rewritten in place with its meaning above it, new ones are added at the
 * end, and `VAR`s not listed are removed with their comment. Every other line
 * (CONST, LIST, functions) stays as written.
 */
export function withVariables(
  variablesText: string | null,
  variables: readonly DiscoverVariable[],
): string {
  const text = variablesText ?? '---\ntitle: Story variables\n---\n';
  const { head, ink } = inkSection(text, 'ink');
  const lines = ink.split('\n');
  const wanted = new Map(variables.map((variable) => [variable.name, variable]));
  const out: string[] = [];
  const written = new Set<string>();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const next = lines[index + 1];
    // A comment that belongs to the VAR under it goes with that VAR.
    if (COMMENT_LINE.test(line) && next !== undefined && VAR_LINE.test(next)) continue;
    const match = VAR_LINE.exec(line);
    if (match === null) {
      out.push(line);
      continue;
    }
    const variable = wanted.get(match[1]!);
    if (variable === undefined || written.has(variable.name)) continue;
    out.push(...declaration(variable));
    written.add(variable.name);
  }
  while (out.length > 0 && out.at(-1)!.trim() === '') out.pop();
  for (const variable of variables) {
    if (!written.has(variable.name)) out.push(...declaration(variable));
  }
  return `${head}${out.join('\n')}\n`;
}

/** What a chapter's frontmatter says about its place in discovery. */
interface BeatFields {
  discover: 'seed' | 'written' | null;
  from: string | null;
  parent: string | null;
  ink: string | null;
  ending: boolean;
}

function beatFields(text: string): BeatFields {
  const { frontmatter } = parseFrontmatter(text);
  const discover = stringField(frontmatter, 'discover');
  return {
    discover: discover === 'seed' || discover === 'written' ? discover : null,
    from: stringField(frontmatter, 'discover-from'),
    parent: stringField(frontmatter, 'discover-parent'),
    ink: stringField(frontmatter, 'discover-ink'),
    ending: frontmatter?.['discover-ending'] === true,
  };
}

/** A seed's ink: a TODO the compiler reports, and an end so the story still plays. */
function seedInk(choiceText: string): string {
  return `TODO: Write what happens after "${choiceText.replace(/\s+/gu, ' ').trim()}".\n-> END\n`;
}

function isSeedInk(ink: string): boolean {
  const lines = ink
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('//'));
  return lines.length === 2 && /^TODO:/u.test(lines[0]!) && /^->\s*END$/u.test(lines[1]!);
}

/** A chapter of an interactive book, as discovery reads it. */
export interface DiscoverChapter {
  id: string;
  path: string;
  title: string;
  number: unknown;
  /** The whole file. */
  text: string;
}

function noteOf(text: string): string {
  return (
    section(inkSection(text, 'chapter').head.replace(/^---[\s\S]*?\n---\n/u, ''), 'Seed') ?? ''
  );
}

/**
 * Each chapter's place in discovery. A seed is a chapter marked `seed`
 * whose ink is still the seed's; one written over by hand counts as a
 * written, edited beat. A beat is stale when the chapter it continues has
 * different ink from when it was written.
 */
export function discoverBeats(
  chapters: readonly DiscoverChapter[],
  reads: ReadonlySet<string>,
): DiscoverBeat[] {
  const byId = new Map(chapters.map((chapter) => [chapter.id, chapter]));
  return orderChapters(chapters).flatMap((chapter) => {
    const fields = beatFields(chapter.text);
    if (fields.discover === null) return [];
    const ink = inkSection(chapter.text, 'chapter').ink;
    const seed = fields.discover === 'seed' && isSeedInk(ink);
    const parent = fields.from === null ? undefined : byId.get(fields.from);
    const stale =
      !seed &&
      fields.parent !== null &&
      parent !== undefined &&
      inkHash(inkSection(parent.text, 'chapter').ink) !== fields.parent;
    return [
      {
        chapterId: chapter.id,
        title: chapter.title,
        path: chapter.path,
        knot: inkKnotName(chapter.id),
        state: seed ? ('seed' as const) : ('written' as const),
        ending: !seed && fields.ending,
        read: reads.has(chapter.id),
        edited: !seed && (fields.ink === null || fields.ink !== inkHash(ink)),
        stale,
        from: fields.from,
        note: seed ? noteOf(chapter.text) : '',
      },
    ];
  });
}

/** A written beat that leads nowhere yet: it ends without choices and is not an ending. */
function needsChoices(beat: DiscoverBeat, node: StoryNode | undefined): boolean {
  if (beat.state !== 'written' || beat.ending || node === undefined) return false;
  return (
    node.choices.length === 0 &&
    node.diverts.every((divert) => divert.target === 'END' || divert.target === 'DONE')
  );
}

/** A beat for the beat writer to write, and why. */
export interface FrontierItem {
  chapterId: string;
  kind: 'beat' | 'choices' | 'rewrite';
  /** Choices from the reader's beat: 0 for the beat itself. */
  depth: number;
}

/** The chapters a chapter's choices and diverts lead to, by chapter id. */
function onward(node: StoryNode | undefined, chapterOfKnot: ReadonlyMap<string, string>): string[] {
  if (node === undefined) return [];
  const targets = [
    ...node.choices.map((choice) => choice.target),
    ...node.diverts.map((divert) => divert.target),
  ];
  const ids = targets.flatMap((target) => {
    if (target === null) return [];
    const id = chapterOfKnot.get(target.split('.')[0]!);
    return id === undefined ? [] : [id];
  });
  return [...new Set(ids)];
}

/**
 * What lead mode writes from where the reader is (ADR 0033): every seed and
 * every beat that still needs choices within `lookahead` choices of the
 * reader's beat, nearest first, and the stale beats in that reach that no
 * one has read or edited. Only written beats are looked past.
 */
export function leadFrontier(
  beats: readonly DiscoverBeat[],
  nodes: readonly StoryNode[],
  current: string,
  lookahead: number,
): FrontierItem[] {
  const beatOf = new Map(beats.map((beat) => [beat.chapterId, beat]));
  const nodeOf = new Map(
    nodes.filter((node) => node.kind === 'chapter').map((node) => [node.chapterId!, node]),
  );
  const chapterOfKnot = new Map(
    nodes
      .filter((node) => node.kind === 'chapter' && node.chapterId !== null)
      .map((node) => [node.name, node.chapterId!]),
  );
  const items: FrontierItem[] = [];
  const seen = new Set<string>();
  let layer = [current];
  for (let depth = 0; depth <= lookahead && layer.length > 0; depth += 1) {
    const next: string[] = [];
    for (const id of layer) {
      if (seen.has(id)) continue;
      seen.add(id);
      const beat = beatOf.get(id);
      if (beat === undefined) {
        // A chapter discovery does not manage: look past it, but write nothing in it.
        if (depth < lookahead) next.push(...onward(nodeOf.get(id), chapterOfKnot));
        continue;
      }
      if (beat.state === 'seed') {
        items.push({ chapterId: id, kind: 'beat', depth });
        continue;
      }
      if (beat.stale && !beat.read && !beat.edited && depth > 0) {
        items.push({ chapterId: id, kind: 'rewrite', depth });
      }
      if (needsChoices(beat, nodeOf.get(id))) {
        // Its choices are a layer of their own, as far off as the beats after them.
        if (depth < lookahead) items.push({ chapterId: id, kind: 'choices', depth });
        continue;
      }
      if (depth < lookahead) next.push(...onward(nodeOf.get(id), chapterOfKnot));
    }
    layer = next;
  }
  return items.sort((left, right) => left.depth - right.depth);
}

/** Where one of a beat's choices leads. */
type ChoiceTarget =
  { kind: 'new'; note: string } | { kind: 'existing'; chapterId: string } | { kind: 'end' };

/** A choice as the beat writer proposes it. */
export interface BeatChoice {
  text: string;
  /** What the choice means: the approach it takes. */
  intent: string;
  /** What it changes. */
  consequence: string;
  /** An ink condition, without braces; empty for always offered. */
  condition: string;
  /** `~` lines without the `~`. */
  effects: string[];
  to: ChoiceTarget;
}

/** A beat as the beat writer proposes it. */
export interface BeatProposal {
  title: string;
  /** The beat's prose as ink, without its closing choices. */
  ink: string;
  /** Whether it ends the story; an ending has no choices. */
  ending: boolean;
  /** One line on what happens, for the beat's planning notes. */
  summary: string;
  choices: BeatChoice[];
}

/** What writing a beat changes: file texts by path. */
export interface BeatFiles {
  /** The beat's chapter file. */
  chapter: { path: string; text: string };
  /** New seed chapters, one per choice to a new beat. */
  seeds: Array<{ id: string; path: string; text: string }>;
}

function chapterPath(number: number): { id: string; path: string } {
  const id = `chapter-${String(number).padStart(2, '0')}`;
  return { id, path: `chapters/${id}.md` };
}

/** The number after every chapter's, for new chapters. */
export function nextChapterNumber(chapters: readonly DiscoverChapter[]): number {
  let highest = 0;
  for (const chapter of chapters) {
    const number = Number(chapter.number);
    if (Number.isInteger(number) && number > highest) highest = number;
    const named = /chapter-(\d+)$/u.exec(chapter.id)?.[1];
    if (named !== undefined) highest = Math.max(highest, Number(named));
  }
  return highest + 1;
}

function titleFrom(text: string): string {
  const title = text.replace(/\s+/gu, ' ').trim();
  return title.length <= 80 ? title : `${title.slice(0, 77).trimEnd()}…`;
}

/** A seed chapter: reached by a choice, with the writer's or the beat writer's note. */
export function seedChapter(input: {
  number: number;
  title: string;
  fromId: string;
  fromTitle: string;
  choiceText: string;
  note: string;
}): { id: string; path: string; text: string } {
  const { id, path } = chapterPath(input.number);
  const reached = `Reached by choosing "${input.choiceText.trim()}" in *${input.fromTitle.trim()}*.`;
  return {
    id,
    path,
    text: [
      '---',
      `title: ${JSON.stringify(titleFrom(input.title))}`,
      `number: ${input.number}`,
      'status: outline',
      'mode: discovered',
      'discover: "seed"',
      `discover-from: ${JSON.stringify(input.fromId)}`,
      '---',
      '',
      '## Seed',
      '',
      reached,
      ...(input.note.trim() === '' ? [] : ['', input.note.trim()]),
      '',
      '## Chapter Text',
      '',
      seedInk(input.choiceText),
    ].join('\n'),
  };
}

function choiceNote(choice: BeatChoice, leads: string): string {
  const parts = [choice.intent.trim(), choice.consequence.trim()].filter((part) => part !== '');
  return `- **${choice.text.trim()}** (${leads})${parts.length === 0 ? '' : `: ${parts.join(' — ')}`}`;
}

/** Where a choice leads, in words. */
function leadsTo(target: ChoiceTarget, titleOf: (chapterId: string) => string | undefined): string {
  if (target.kind === 'end') return 'the end';
  if (target.kind === 'new') return 'a new beat';
  return `rejoins ${titleOf(target.chapterId) ?? target.chapterId}`;
}

/** Closing choices as ink, their planning notes, and a seed for each that leads somewhere new. */
function closingChoices(input: {
  choices: readonly BeatChoice[];
  chapterId: string;
  title: string;
  chapters: readonly DiscoverChapter[];
  nextNumber: number;
}): { closing: ClosingChoice[]; notes: string[]; seeds: BeatFiles['seeds'] } {
  const titleOf = (id: string) => input.chapters.find((entry) => entry.id === id)?.title;
  let number = input.nextNumber;
  const seeds: BeatFiles['seeds'] = [];
  const closing: ClosingChoice[] = [];
  const notes: string[] = [];
  for (const choice of input.choices) {
    let to: string;
    if (choice.to.kind === 'new') {
      const seed = seedChapter({
        number,
        title: choice.text,
        fromId: input.chapterId,
        fromTitle: input.title,
        choiceText: choice.text,
        note: choice.to.note,
      });
      number += 1;
      seeds.push(seed);
      to = inkKnotName(seed.id);
    } else if (choice.to.kind === 'existing') {
      to = inkKnotName(choice.to.chapterId);
    } else {
      to = 'END';
    }
    closing.push({
      text: choice.text.trim(),
      once: true,
      condition: choice.condition.trim(),
      effects: choice.effects.map((effect) => effect.trim()).filter((effect) => effect !== ''),
      to,
    });
    notes.push(choiceNote(choice, leadsTo(choice.to, titleOf)));
  }
  return { closing, notes, seeds };
}

/**
 * A written chapter with choices at its end in place of the end it has, and
 * a seed for each new branch. Its planning and prose stay as written; its
 * choices' notes are added under `## Choices`. Null when its ending is ink
 * the choices screen cannot read.
 */
export function choicesFiles(input: {
  chapter: DiscoverChapter;
  choices: readonly BeatChoice[];
  chapters: readonly DiscoverChapter[];
  nextNumber: number;
}): BeatFiles | null {
  const { head, ink } = inkSection(input.chapter.text, 'chapter');
  const read = readEnding(ink);
  if (!read.editable || read.ending.choices.length > 0) return null;
  const { closing, notes, seeds } = closingChoices({
    choices: input.choices,
    chapterId: input.chapter.id,
    title: input.chapter.title,
    chapters: input.chapters,
    nextNumber: input.nextNumber,
  });
  const body = `${read.before.trimEnd() === '' ? '' : `${read.before.trimEnd()}\n\n`}${closing.flatMap((entry) => choiceLines(entry)).join('\n')}\n`;
  let planning = head;
  for (const note of notes) planning = withChoiceNote(planning, note);
  let text = `${planning}${body}`;
  // Still the beat writer's beat if it was; one the writer wrote or edited stays theirs.
  if (beatFields(input.chapter.text).ink === inkHash(ink)) {
    text = setFrontmatterField(text, 'discover-ink', JSON.stringify(inkHash(body)));
  }
  return { chapter: { path: input.chapter.path, text }, seeds };
}

/**
 * A beat's files: its chapter (the file it replaces keeps its number) with
 * the proposal's ink and closing choices, its planning notes (what happens,
 * and each choice's intent and consequence), and a seed for every choice that
 * leads somewhere new.
 */
export function beatFiles(input: {
  proposal: BeatProposal;
  /** The chapter the beat is written into. */
  chapter: { id: string; path: string; number: number; text: string | null };
  /** The chapter it continues, for its frontmatter and the seeds' notes; null for the opening. */
  from: { id: string; ink: string } | null;
  /** The chapters it may lead to, for titles. */
  chapters: readonly DiscoverChapter[];
  /** The number for the first new seed. */
  nextNumber: number;
}): BeatFiles {
  const { proposal, chapter } = input;
  const { closing, notes, seeds } = closingChoices({
    choices: proposal.ending ? [] : proposal.choices,
    chapterId: chapter.id,
    title: proposal.title,
    chapters: input.chapters,
    nextNumber: input.nextNumber,
  });

  const prose = proposal.ink.replace(/\r\n?/gu, '\n').trimEnd();
  const ending = closing.length === 0 ? ['-> END'] : closing.flatMap((entry) => choiceLines(entry));
  const ink = `${prose === '' ? '' : `${prose}\n\n`}${ending.join('\n')}\n`;

  let frontmatter = chapter.text ?? `---\ntitle: ""\nnumber: ${chapter.number}\n---\n`;
  const set = (key: string, value: string) => {
    frontmatter = setFrontmatterField(frontmatter, key, value);
  };
  set('title', JSON.stringify(titleFrom(proposal.title)));
  set('number', String(chapter.number));
  set('status', 'draft');
  set('mode', 'discovered');
  set('discover', '"written"');
  if (input.from === null) {
    frontmatter = removeFrontmatterField(frontmatter, 'discover-from');
    frontmatter = removeFrontmatterField(frontmatter, 'discover-parent');
  } else {
    set('discover-from', JSON.stringify(input.from.id));
    set('discover-parent', JSON.stringify(inkHash(input.from.ink)));
  }
  set('discover-ink', JSON.stringify(inkHash(ink)));
  if (proposal.ending) set('discover-ending', 'true');
  else frontmatter = removeFrontmatterField(frontmatter, 'discover-ending');
  const front = /^\uFEFF?---[\s\S]*?\n---[ \t]*\n?/u.exec(frontmatter)?.[0] ?? '';

  const planning = [
    '## Beat',
    '',
    proposal.summary.trim() === '' ? '_Written by discovery._' : proposal.summary.trim(),
    '',
    ...(notes.length === 0 ? [] : ['## Choices', '', ...notes, '']),
    '## Chapter Text',
    '',
  ];
  return {
    chapter: { path: chapter.path, text: `${front.trimEnd()}\n\n${planning.join('\n')}${ink}` },
    seeds,
  };
}

/**
 * A chapter with one more closing choice, for the reader's own action. The
 * chapter must end in choices the choices screen can read.
 */
export function withAddedChoice(text: string, choice: ClosingChoice, note: string): string | null {
  const { head, ink } = inkSection(text, 'chapter');
  const read = readEnding(ink);
  if (!read.editable || read.ending.choices.length === 0) return null;
  const lines = [...read.ending.choices, choice].flatMap((entry) => choiceLines(entry));
  const body = `${read.before.trimEnd() === '' ? '' : `${read.before.trimEnd()}\n\n`}${lines.join('\n')}\n`;
  const planning = withChoiceNote(head, note);
  let result = `${planning}${body}`;
  if (beatFields(text).ink === inkHash(ink)) {
    result = setFrontmatterField(result, 'discover-ink', JSON.stringify(inkHash(body)));
  }
  return result;
}

/** A chapter's planning with one more line under `## Choices`, added before `## Chapter Text` if missing. */
function withChoiceNote(head: string, note: string): string {
  const choices = section(head, 'Choices');
  if (choices !== null) {
    const updated = withSection(head.trimEnd(), 'Choices', `${choices}\n${note}`);
    return updated.endsWith('\n') ? updated : `${updated}\n`;
  }
  const lines = head.split('\n');
  const at = lines.findIndex((line) => /^##\s+Chapter Text\s*$/iu.test(line));
  if (at === -1) return head;
  return [...lines.slice(0, at), '## Choices', '', note, '', ...lines.slice(at)].join('\n');
}

/** A beat's ink with the stale mark cleared: the chapter it continues, as it is now, is its parent. */
export function markReviewed(text: string, parentInk: string): string {
  return setFrontmatterField(text, 'discover-parent', JSON.stringify(inkHash(parentInk)));
}

/** A seed with a new note. */
export function withSeedNote(text: string, note: string): string {
  const { head, ink } = inkSection(text, 'chapter');
  const current = section(head, 'Seed') ?? '';
  const reached = current.split('\n')[0] ?? '';
  const updated = withSection(
    head.trimEnd(),
    'Seed',
    [reached, ...(note.trim() === '' ? [] : ['', note.trim()])].join('\n'),
  );
  return `${updated.endsWith('\n') ? updated : `${updated}\n`}${ink}`;
}
