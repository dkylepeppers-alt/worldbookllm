import type { DiscoverSetup, DiscoverVariable } from '@worldbookllm/shared';

/**
 * What the beat writer is told (ADR 0033): its standing instructions, the
 * book's setup and rules, and for each beat the path the reader played, the
 * state there, and the beats around it.
 */

const LENGTH = {
  scene: 'Each beat is one scene: about 250 to 600 words of prose before its choices.',
  chapter: 'Each beat is a short chapter: about 900 to 1,800 words of prose before its choices.',
} as const;

const REJOIN = {
  often:
    'The writer wants branches to rejoin often: prefer leading a choice into an existing beat when the story allows it, and converge what differs first.',
  sometimes: 'Rejoin branches when it serves the story, and branch when the difference matters.',
  rarely:
    'The writer wants branches to stay apart: rejoin only when the story clearly calls for it.',
} as const;

/** The beat writer's standing instructions. */
/** The custom agent the writer picked for the beat writer: its instructions and the skills it may load. */
export interface BeatRole {
  name: string;
  instructions: string;
  /** The skills it may load; null allows every installed skill. */
  allowed: ReadonlySet<string> | null;
  /**
   * Its skills. A skill the agent names comes loaded, with the text
   * activate_skill gives; with every skill allowed, each is listed (content
   * null) for the beat writer to load when it fits.
   */
  skills: ReadonlyArray<{ name: string; description: string; content: string | null }>;
}

export function beatSystemPrompt(input: {
  bookTitle: string;
  setup: DiscoverSetup;
  rules: string;
  role: BeatRole | null;
}): string {
  const { setup } = input;
  return [
    `You are the beat writer in worldbookllm, writing the interactive book "${input.bookTitle}" one beat at a time while a reader plays it. The book is written in inkle's ink.`,
    '',
    '## How you work',
    'Call exactly one of the writing tools (write_beat, write_choices, accept_action, or decline_action) to finish; the task says which. Each is checked before anything is written: if it reports problems, fix every one and call it again. You may call read_file or search first to check the bible, and propose_variable when the story needs state that no declared variable tracks.',
    `- ${LENGTH[setup.beatLength]}`,
    `- End every beat with exactly ${setup.choices} choices, unless it ends the story (ending: true, no choices). The reader also always has a "Something else" option of their own; never write one.`,
    `- ${REJOIN[setup.rejoin]}`,
    setup.endings.trim() === ''
      ? '- End the story only where it has earned an ending.'
      : `- Endings the writer wants: ${setup.endings.trim()}. End the story only where it has earned one of them.`,
    '- Open the beat by acknowledging the choice that led here, even in one line.',
    '- Before a choice rejoins an existing beat, make what differs between the paths agree in this beat (who is where, what they hold, what they know), or set a variable the rejoin reads. Never rely on the rejoined beat changing.',
    '- Stay true to the bible and to everything on the path so far. Do not invent major canon (new main characters, new rules of the world) unless the story kernel invites it; when you add a detail, keep it small and consistent.',
    '- Write in the voice, person, and tense of the book\'s prose and style sheet, as the chapters on the path show it: if they say "she", every line of the beat does too. Never slip into "you" unless the book is written in the second person.',
    ...roleSection(input.role),
    '',
    '## Writing ink',
    '- Each line of ink is a paragraph. Inline *emphasis* works. A line that is only `# break` is a scene break.',
    '- Vary prose with what the reader did: `{trust > 1: He meets her eyes.|He looks away.}`, or `{met_mara: …}`. Use only declared variables, and visit counts of existing knots (a chapter id with - as _, e.g. chapter_04).',
    '- In-scene choices are allowed inside the prose if they gather back (`* [Look] …` then `- ` to gather) before the beat ends. The closing choices are not written in ink: give them in choices.',
    '- Escape what ink would read as markup in prose: \\{ \\} \\| \\# \\[ \\] \\~ and a backslash before // in a web address.',
    '- Never write `=== knot ===` lines, INCLUDE, VAR, or a final divert; worldbookllm adds them.',
    '',
    '## The rules for choices',
    'Every set of choices must follow these rules. They are checked, and a set that breaks them is sent back.',
    input.rules.trim(),
  ].join('\n');
}

interface BeatPlace {
  /** The chapter being written or continued. */
  chapterId: string;
  /** The choice that leads here, for a seed. */
  choiceText: string | null;
  /** The writer's or an earlier beat's note on where this goes. */
  note: string;
  /** The beat it continues, with its ink, or null for the opening. */
  parent: { chapterId: string; title: string; ink: string } | null;
  /** Other beats whose choices lead here, with their prose. */
  otherParents: Array<{ chapterId: string; title: string; prose: string; choice: string }>;
}

export interface BeatPromptInput {
  kernel: string;
  shape: string;
  /** story.md's body: synopsis, tone, notes. */
  storyNotes: string;
  styleSheet: string | null;
  /** Bible entries, as `### Title (path)` and their text. */
  bible: string;
  variables: ReadonlyArray<DiscoverVariable & { value: string | null }>;
  /** What the reader has read on this path, or null when there is no reader here. */
  transcript: string | null;
  /** Beats a choice could rejoin: id, title, and one line on what happens. */
  chapters: ReadonlyArray<{ chapterId: string; title: string; summary: string; state: string }>;
  place: BeatPlace;
}

function roleSection(role: BeatRole | null): string[] {
  if (role === null || (role.instructions.trim() === '' && role.skills.length === 0)) return [];
  return [
    '',
    `## Your role: ${role.name}`,
    'The writer chose this role for the beat writer. Write as it says; the tools, the rules above, and the rules for choices still apply.',
    ...(role.instructions.trim() === '' ? [] : ['', role.instructions.trim()]),
    ...skillsSection(role),
  ];
}

function skillsSection(role: BeatRole): string[] {
  const loaded = role.skills.filter((skill) => skill.content !== null);
  const listed = role.skills.filter((skill) => skill.content === null);
  return [
    ...(loaded.length === 0
      ? []
      : [
          '',
          '### Skills',
          'The writer gave this role these skills. They are loaded below: follow them on every beat, and load their reference files with read_skill_file when they say to.',
          ...loaded.flatMap((skill) => ['', `#### Skill: ${skill.name}`, skill.content!.trim()]),
        ]),
    ...(listed.length === 0
      ? []
      : [
          '',
          '### Skills you can load',
          'When a skill below fits the beat, load it with activate_skill and follow it; load its references with read_skill_file when it says to.',
          ...listed.map((skill) => `- ${skill.name}: ${skill.description}`),
        ]),
  ];
}

function variablesSection(input: BeatPromptInput): string[] {
  if (input.variables.length === 0) {
    return [
      '## Story variables',
      'None are declared. Propose one with propose_variable if the story needs it.',
    ];
  }
  return [
    '## Story variables',
    'Declared, with what each means' +
      (input.variables.some((v) => v.value !== null) ? ' and its value on this path now' : '') +
      ':',
    ...input.variables.map(
      (variable) =>
        `- ${variable.name} (starts ${variable.initial})${variable.value === null ? '' : ` = ${variable.value} now`}${variable.meaning === '' ? '' : `: ${variable.meaning}`}`,
    ),
  ];
}

function storySection(input: BeatPromptInput): string[] {
  return [
    '## Story kernel',
    input.kernel.trim() === '' ? '(none written)' : input.kernel.trim(),
    ...(input.shape.trim() === '' ? [] : ['', '## Shape and tone', input.shape.trim()]),
    ...(input.storyNotes.trim() === '' ? [] : ['', '## From story.md', input.storyNotes.trim()]),
    ...(input.styleSheet === null ? [] : ['', '## Style sheet', input.styleSheet.trim()]),
    '',
    '## Bible',
    input.bible.trim() === '' ? '(no bible entries yet)' : input.bible.trim(),
    '',
    ...variablesSection(input),
  ];
}

function placeSection(input: BeatPromptInput): string[] {
  const { place } = input;
  const chapters = input.chapters.filter((chapter) => chapter.chapterId !== place.chapterId);
  return [
    ...(input.transcript === null
      ? []
      : ['## What the reader has read on this path', input.transcript.trim(), '']),
    ...(place.parent === null || input.transcript !== null
      ? []
      : [
          `## The beat before: ${place.parent.title} (${place.parent.chapterId})`,
          place.parent.ink.trim(),
          '',
        ]),
    ...(place.otherParents.length === 0
      ? []
      : [
          '## Other beats that lead here',
          'This beat must read right from each of these too.',
          ...place.otherParents.map(
            (other) =>
              `### ${other.title} (${other.chapterId}), by choosing "${other.choice}"\n${other.prose.trim()}`,
          ),
          '',
        ]),
    '## Beats a choice could rejoin',
    chapters.length === 0
      ? '(none yet)'
      : chapters
          .map(
            (chapter) =>
              `- ${chapter.chapterId}: ${chapter.title} (${chapter.state})${chapter.summary === '' ? '' : ` — ${chapter.summary}`}`,
          )
          .join('\n'),
  ];
}

/** The task, as the user message the beat writer answers. */
export function beatTaskPrompt(
  input: BeatPromptInput,
  task:
    | { kind: 'beat'; direction: string | null; avoid: readonly string[] }
    | { kind: 'choices'; ink: string; title: string }
    | { kind: 'rewrite'; ink: string; title: string; choices: string }
    | {
        kind: 'something-else';
        action: string;
        /** The writer overruled a decline: the action happens. */
        force: boolean;
        ink: string;
        title: string;
        choices: string;
      },
): string {
  const { place } = input;
  const instructions: string[] = [];
  if (task.kind === 'beat') {
    instructions.push(
      '## Your task',
      place.parent === null
        ? 'Write the opening beat of the story from the kernel, and the choices it ends with. Call write_beat.'
        : `Write the beat that follows when the reader chooses "${place.choiceText ?? ''}" in "${place.parent.title}", and the choices it ends with. Call write_beat.`,
      ...(place.note.trim() === '' ? [] : [`Notes on this beat: ${place.note.trim()}`]),
      ...(task.direction === null ? [] : [`The writer's direction: ${task.direction}`]),
      ...(task.avoid.length === 0
        ? []
        : [
            'Other drafts of this beat already go these ways. Take the story somewhere clearly different:',
            ...task.avoid.map((summary) => `- ${summary}`),
          ]),
    );
  } else if (task.kind === 'choices') {
    instructions.push(
      '## Your task',
      `The beat "${task.title}" (${place.chapterId}) is written, but leads nowhere yet. Write the choices it ends with, from where its prose leaves the reader. Call write_choices.`,
      '',
      '## The beat',
      task.ink.trim(),
    );
  } else if (task.kind === 'rewrite') {
    instructions.push(
      '## Your task',
      `The beat before "${task.title}" (${place.chapterId}) changed after it was written, and no reader has read it yet. Rewrite it so it follows from the beat before as that reads now. Keep where its choices lead (the beats after it are written), but you may reword them. Call write_beat.`,
      '',
      '## The beat as it is',
      task.ink.trim(),
      '',
      '## Its choices now',
      task.choices,
    );
  } else {
    instructions.push(
      '## Your task',
      `The reader is at the end of "${task.title}" (${place.chapterId}) and, instead of the choices offered, typed their own action:`,
      `> ${task.action}`,
      '',
      task.force
        ? 'The writer has decided this happens here, even if it does not fit what the scene has set up. Call accept_action: rewrite it as a choice in the book voice (keep what the reader meant, and do not water it down) and write the beat it leads to, with its own choices. Where it strains the scene, the character, or what they know, let the beat show how it happens or what it costs.'
        : 'Judge it by the rules for choices: is it possible in this scene, with what the character knows, and true to the character? If it is, call accept_action: rewrite it as a choice in the book voice (keep what the reader meant) and write the beat it leads to, with its own choices. If it is not, call decline_action with a short reason addressed to the reader and the nearest action that would work.',
      '',
      '## The choices offered now',
      task.choices,
    );
  }
  return [...storySection(input), '', ...placeSection(input), '', ...instructions].join('\n');
}

/** The review pass: the rules applied to a set of choices by a second request. */
export function reviewPrompt(input: {
  rules: string;
  bible: string;
  transcript: string;
  beat: string;
  choices: string;
}): string {
  return [
    'You review the choices an interactive book offers its reader. Apply the rules strictly but fairly: flag only real breaches, not style preferences.',
    '',
    '## The rules',
    input.rules.trim(),
    '',
    '## Bible (for what is in character and what exists)',
    input.bible.trim() === '' ? '(none)' : input.bible.trim(),
    '',
    '## What the reader has read',
    input.transcript.trim() === '' ? '(this is the opening)' : input.transcript.trim(),
    '',
    '## The beat',
    input.beat.trim(),
    '',
    '## Its choices',
    input.choices,
    '',
    'Reply with JSON only, no prose: {"pass": true} if the set follows every rule, or {"pass": false, "problems": ["…", "…"]} naming each rule broken, which choice, and why, in one sentence each.',
  ].join('\n');
}
