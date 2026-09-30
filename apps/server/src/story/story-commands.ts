/**
 * The story CLI command table, vendored from story-skills 0.18.0
 * (src/commands.js COMMANDS and src/options.js OPTIONS). StoryCli validates
 * every invocation against it before spawning anything, and
 * story-commands.test.ts fails if an upgrade changes the upstream table, so
 * the allowlist cannot drift silently.
 *
 * project: how the command finds its project — "positional"/"flag" take
 * --path (which StoryCli always sets itself), "none" creates a project in
 * the working directory. maxArgs: positional arguments after the command
 * name (null = unbounded); for "positional" commands that slot is the
 * project path, which StoryCli never passes.
 */
interface StoryOptionSpec {
  value: boolean;
  repeatable: boolean;
}

export interface StoryCommandSpec {
  project: 'positional' | 'flag' | 'none';
  maxArgs: number | null;
  options: Readonly<Record<string, StoryOptionSpec>>;
}

const V: StoryOptionSpec = { value: true, repeatable: false };
const R: StoryOptionSpec = { value: true, repeatable: true };
const B: StoryOptionSpec = { value: false, repeatable: false };

export const STORY_COMMANDS = {
  init: {
    project: 'none',
    maxArgs: null,
    options: {
      dir: V,
      genre: V,
      'sub-genre': V,
      'setting-era': V,
      theme: R,
      themes: R,
      pov: V,
      tense: V,
      form: V,
      synopsis: V,
      series: V,
      'book-number': V,
      follows: R,
      precedes: R,
      force: B,
    },
  },
  import: {
    project: 'none',
    maxArgs: 1,
    options: {
      title: V,
      dir: V,
      genre: V,
      'sub-genre': V,
      'setting-era': V,
      theme: R,
      themes: R,
      pov: V,
      tense: V,
      synopsis: V,
      force: B,
    },
  },
  validate: { project: 'positional', maxArgs: 1, options: { json: B } },
  reindex: { project: 'positional', maxArgs: 1, options: {} },
  wordcount: { project: 'positional', maxArgs: 1, options: { write: B } },
  links: { project: 'positional', maxArgs: 1, options: { json: B } },
  continuity: { project: 'positional', maxArgs: 1, options: { json: B } },
  knowledge: { project: 'flag', maxArgs: 1, options: { at: V, json: B } },
  context: { project: 'flag', maxArgs: 1, options: { budget: V, scenes: V, json: B } },
  compare: { project: 'positional', maxArgs: 1, options: { ref: V, against: V, anchor: R } },
  similarity: {
    project: 'positional',
    maxArgs: 1,
    options: { against: V, 'min-words': V, json: B },
  },
  progress: { project: 'positional', maxArgs: 1, options: { log: B, date: V, json: B } },
  timeline: { project: 'positional', maxArgs: 1, options: { json: B } },
  prose: {
    project: 'positional',
    maxArgs: 1,
    options: { json: B, 'max-filter-words': V, 'max-adverbs': V, 'max-bookisms': V, baseline: B },
  },
  diagram: { project: 'flag', maxArgs: 1, options: { out: V } },
  names: { project: 'flag', maxArgs: null, options: {} },
  pacing: { project: 'positional', maxArgs: 1, options: { json: B } },
  clues: { project: 'positional', maxArgs: 1, options: { json: B } },
  voices: { project: 'positional', maxArgs: 1, options: { json: B } },
  series: { project: 'positional', maxArgs: 1, options: { json: B } },
  passes: { project: 'positional', maxArgs: 1, options: { init: B, start: V, done: V } },
  report: { project: 'positional', maxArgs: 1, options: { actionable: B, json: B } },
  next: { project: 'positional', maxArgs: 1, options: { json: B } },
  doctor: { project: 'positional', maxArgs: 1, options: { json: B } },
  migrate: { project: 'positional', maxArgs: 1, options: {} },
  add: {
    project: 'flag',
    maxArgs: null,
    options: {
      id: V,
      number: V,
      chapter: V,
      scene: V,
      type: V,
      role: V,
      status: V,
      mode: V,
      date: V,
      time: V,
      'travel-hours': V,
      dilemma: V,
      sequel: B,
      outcome: V,
      hook: V,
      location: R,
      locations: R,
      character: R,
      characters: R,
      mention: R,
      mentions: R,
      member: R,
      members: R,
      owner: V,
      arc: R,
      arcs: R,
      introduced: V,
      resolved: V,
      planted: V,
      payoff: V,
      'significance-delayed': B,
      'red-herring': B,
      category: V,
      alias: R,
      aliases: R,
      region: V,
      population: V,
      'controlled-by': V,
      prevalence: V,
      acts: R,
      act: R,
      placement: V,
      order: V,
      heading: B,
      source: R,
      sources: R,
      'used-in': R,
      accuracy: V,
      confidence: V,
      method: V,
      risk: R,
      theme: R,
      themes: R,
      pov: V,
    },
  },
  rename: { project: 'flag', maxArgs: null, options: { id: V } },
  remove: { project: 'flag', maxArgs: 2, options: {} },
  move: { project: 'flag', maxArgs: 2, options: { number: V, chapter: V, scene: V } },
  export: { project: 'positional', maxArgs: 1, options: { out: V } },
  build: {
    project: 'positional',
    maxArgs: 1,
    options: { out: V, format: V, shunn: B, trim: V, stamp: V, 'note-url': V },
  },
  synopsis: { project: 'positional', maxArgs: 1, options: { pages: V, out: V } },
} as const satisfies Record<string, StoryCommandSpec>;

export type StoryCommandName = keyof typeof STORY_COMMANDS;

export function isStoryCommand(name: string): name is StoryCommandName {
  return Object.hasOwn(STORY_COMMANDS, name);
}
