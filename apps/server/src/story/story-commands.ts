/**
 * The story CLI command table, vendored from story-skills 0.23.0
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
      'dry-run': B,
      json: B,
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
      language: V,
      bylines: B,
      force: B,
      'dry-run': B,
      json: B,
    },
  },
  validate: {
    project: 'positional',
    maxArgs: 1,
    options: {
      json: B,
    },
  },
  reindex: {
    project: 'positional',
    maxArgs: 1,
    options: {
      'dry-run': B,
      json: B,
    },
  },
  wordcount: {
    project: 'positional',
    maxArgs: 1,
    options: {
      write: B,
      'dry-run': B,
      json: B,
    },
  },
  links: {
    project: 'positional',
    maxArgs: 1,
    options: {
      json: B,
    },
  },
  continuity: {
    project: 'positional',
    maxArgs: 1,
    options: {
      json: B,
    },
  },
  check: {
    project: 'positional',
    maxArgs: 1,
    options: {
      strict: B,
      json: B,
    },
  },
  knowledge: {
    project: 'flag',
    maxArgs: 1,
    options: {
      at: V,
      json: B,
    },
  },
  context: {
    project: 'flag',
    maxArgs: 1,
    options: {
      budget: V,
      scenes: V,
      json: B,
    },
  },
  compare: {
    project: 'positional',
    maxArgs: 1,
    options: {
      ref: V,
      against: V,
      snapshot: V,
      anchor: R,
      json: B,
    },
  },
  similarity: {
    project: 'positional',
    maxArgs: 1,
    options: {
      against: V,
      snapshot: V,
      'min-words': V,
      json: B,
    },
  },
  progress: {
    project: 'positional',
    maxArgs: 1,
    options: {
      log: B,
      date: V,
      weeks: V,
      'dry-run': B,
      json: B,
    },
  },
  timeline: {
    project: 'positional',
    maxArgs: 1,
    options: {
      json: B,
    },
  },
  prose: {
    project: 'positional',
    maxArgs: 1,
    options: {
      json: B,
      'max-filter-words': V,
      'max-adverbs': V,
      'max-bookisms': V,
      baseline: B,
    },
  },
  diagram: {
    project: 'flag',
    maxArgs: 1,
    options: {
      out: V,
      'dry-run': B,
      json: B,
    },
  },
  names: {
    project: 'flag',
    maxArgs: null,
    options: {
      json: B,
    },
  },
  mentions: {
    project: 'flag',
    maxArgs: 2,
    options: {
      json: B,
    },
  },
  pacing: {
    project: 'positional',
    maxArgs: 1,
    options: {
      json: B,
    },
  },
  clues: {
    project: 'positional',
    maxArgs: 1,
    options: {
      json: B,
    },
  },
  grid: {
    project: 'positional',
    maxArgs: 1,
    options: {
      format: V,
      from: V,
      to: V,
      json: B,
    },
  },
  list: {
    project: 'flag',
    maxArgs: 1,
    options: {
      where: R,
      query: V,
      json: B,
    },
  },
  voices: {
    project: 'positional',
    maxArgs: 1,
    options: {
      json: B,
    },
  },
  series: {
    project: 'positional',
    maxArgs: 1,
    options: {
      json: B,
    },
  },
  passes: {
    project: 'positional',
    maxArgs: 1,
    options: {
      init: B,
      start: V,
      done: V,
      'dry-run': B,
      json: B,
    },
  },
  snapshot: {
    project: 'flag',
    maxArgs: 1,
    options: {
      id: V,
      list: B,
      restore: V,
      force: B,
      'dry-run': B,
      json: B,
    },
  },
  report: {
    project: 'positional',
    maxArgs: 1,
    options: {
      actionable: B,
      json: B,
    },
  },
  next: {
    project: 'positional',
    maxArgs: 1,
    options: {
      date: V,
      json: B,
    },
  },
  doctor: {
    project: 'positional',
    maxArgs: 1,
    options: {
      fix: B,
      'dry-run': B,
      json: B,
    },
  },
  migrate: {
    project: 'positional',
    maxArgs: 1,
    options: {
      'dry-run': B,
      json: B,
    },
  },
  add: {
    project: 'flag',
    maxArgs: null,
    options: {
      id: V,
      role: V,
      status: V,
      location: R,
      locations: R,
      arc: R,
      type: V,
      region: V,
      population: V,
      'controlled-by': V,
      character: R,
      characters: R,
      prevalence: V,
      member: R,
      members: R,
      owner: V,
      theme: R,
      themes: R,
      acts: R,
      act: R,
      number: V,
      pov: V,
      mention: R,
      mentions: R,
      arcs: R,
      mode: V,
      date: V,
      time: V,
      hook: V,
      beat: V,
      chapter: V,
      scene: V,
      'travel-hours': V,
      sequel: B,
      outcome: V,
      dilemma: V,
      introduced: V,
      resolved: V,
      planted: V,
      payoff: V,
      'significance-delayed': B,
      'red-herring': B,
      category: V,
      alias: R,
      aliases: R,
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
      'dry-run': B,
      json: B,
    },
  },
  rename: {
    project: 'flag',
    maxArgs: null,
    options: {
      id: V,
      prose: B,
      'dry-run': B,
      json: B,
    },
  },
  remove: {
    project: 'flag',
    maxArgs: 2,
    options: {
      'dry-run': B,
      json: B,
    },
  },
  move: {
    project: 'flag',
    maxArgs: 2,
    options: {
      number: V,
      chapter: V,
      scene: V,
      'dry-run': B,
      json: B,
    },
  },
  split: {
    project: 'flag',
    maxArgs: 1,
    options: {
      at: V,
      title: V,
      'dry-run': B,
      json: B,
    },
  },
  merge: {
    project: 'flag',
    maxArgs: 2,
    options: {
      'dry-run': B,
      json: B,
    },
  },
  export: {
    project: 'positional',
    maxArgs: 1,
    options: {
      out: V,
      'include-pending': B,
      'dry-run': B,
      json: B,
    },
  },
  build: {
    project: 'positional',
    maxArgs: 1,
    options: {
      out: V,
      format: V,
      shunn: B,
      anonymous: B,
      trim: V,
      paper: V,
      stamp: V,
      'note-url': V,
      pdf: B,
      'pdf-engine': V,
      spoilers: B,
      'include-pending': B,
      'dry-run': B,
      json: B,
    },
  },
  synopsis: {
    project: 'positional',
    maxArgs: 1,
    options: {
      pages: V,
      out: V,
      'dry-run': B,
      json: B,
    },
  },
} as const satisfies Record<string, StoryCommandSpec>;

export type StoryCommandName = keyof typeof STORY_COMMANDS;

export function isStoryCommand(name: string): name is StoryCommandName {
  return Object.hasOwn(STORY_COMMANDS, name);
}
