import type { BookEntityKind, BookFile } from '@worldbookllm/shared';

/** How the Bible tab groups story-skills entity kinds and singleton files (ADR 0014). */
export interface BibleSection {
  id: string;
  label: string;
  kinds: readonly BookEntityKind[];
  /** Singleton files shown at the top of the section. */
  files: readonly string[];
}

export const BIBLE_SECTIONS: readonly BibleSection[] = [
  { id: 'cast', label: 'Cast', kinds: ['character'], files: [] },
  { id: 'world', label: 'World', kinds: ['location', 'system', 'faction', 'artifact'], files: [] },
  { id: 'plot', label: 'Plot', kinds: ['arc'], files: ['plot/timeline.md'] },
  {
    id: 'threads',
    label: 'Threads',
    kinds: ['question', 'promise', 'clue'],
    files: ['continuity/state.md'],
  },
  { id: 'glossary', label: 'Glossary', kinds: ['term'], files: [] },
  { id: 'research', label: 'Research', kinds: ['research'], files: [] },
  { id: 'matter', label: 'Matter', kinds: ['matter'], files: [] },
];

export const KIND_LABELS: Readonly<Record<string, string>> = {
  character: 'Character',
  location: 'Location',
  system: 'System',
  faction: 'Faction',
  artifact: 'Artifact',
  arc: 'Arc',
  chapter: 'Chapter',
  scene: 'Scene',
  question: 'Question',
  promise: 'Promise',
  clue: 'Clue',
  term: 'Term',
  matter: 'Matter',
  research: 'Research',
  story: 'Story bible',
  'style-sheet': 'Style sheet',
  progress: 'Progress log',
  timeline: 'Timeline',
  state: 'Continuity state',
  exemptions: 'Exemptions',
  registry: 'Registry',
  other: 'File',
};

export function filesOfKind(files: readonly BookFile[], kinds: readonly string[]): BookFile[] {
  return files
    .filter((file) => file.entityId !== null && kinds.includes(file.kind))
    .sort((left, right) => left.title.localeCompare(right.title));
}

/** Link to a book file's screen, keeping the path's slashes readable. */
export function fileHref(slug: string, path: string): string {
  return `/books/${encodeURIComponent(slug)}/files/${path.split('/').map(encodeURIComponent).join('/')}`;
}
