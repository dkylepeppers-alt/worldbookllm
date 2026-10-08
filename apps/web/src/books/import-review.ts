import {
  BOOK_IMPORT_KINDS,
  type BookImportEntry,
  type BookImportKind,
  type BookImportPreview,
  type ChapterPlacement,
  type SourceOrigin,
} from '@worldbookllm/shared';

/** Chapters first: manuscript files are the common case. */
export const IMPORT_KINDS: readonly BookImportKind[] = [
  'chapter',
  ...BOOK_IMPORT_KINDS.filter((kind) => kind !== 'chapter'),
];

/** Every format a single upload converts, and zips of them. */
export const IMPORT_ACCEPT =
  '.md,.markdown,.txt,.html,.htm,.pdf,.json,.zip,text/markdown,text/plain,text/html,application/pdf,application/json,application/zip';

/** One reviewed entry: what the writer keeps, edits, and places before anything is written. */
export interface DraftEntry {
  key: string;
  include: boolean;
  title: string;
  kind: BookImportKind;
  markdown: string;
  origin: SourceOrigin;
  /** The converter's notes for this entry's file, recorded as its provenance. */
  conversionNotes: string[];
  /** Where the entry came from, as shown in the list. */
  source: string;
  numbered?: boolean;
  author?: string | string[];
  /** Chapters in an existing book: `end`, `before:N`, or `replace:N`. */
  placement: string;
}

/** A book chapter a new one can go before, or replace. */
export interface ChapterSlot {
  number: number;
  title: string;
}

let nextKey = 0;

/** Review drafts for a preview's entries, each with its own origin and notes. */
export function draftsFromPreview(
  preview: Pick<BookImportPreview, 'entries' | 'origin' | 'conversionNotes'>,
  fileName: string,
  kinds: readonly BookImportKind[],
): DraftEntry[] {
  return preview.entries.map((entry) => {
    const origin = entry.origin ?? preview.origin;
    nextKey += 1;
    return {
      key: `${fileName}:${nextKey}`,
      include: true,
      title: entry.title,
      kind: kinds.includes(entry.suggestedKind) ? entry.suggestedKind : 'research',
      markdown: entry.markdown,
      origin,
      // A zip's entries carry their own file's notes; its top-level notes list skipped files.
      conversionNotes: entry.conversionNotes ?? (entry.origin ? [] : preview.conversionNotes),
      source: origin.type === 'file' ? origin.fileName : fileName,
      ...(entry.numbered === undefined ? {} : { numbered: entry.numbered }),
      ...(entry.author === undefined ? {} : { author: entry.author }),
      placement: 'end',
    };
  });
}

function placementOf(value: string): ChapterPlacement {
  const [at, chapter] = value.split(':');
  if ((at === 'before' || at === 'replace') && chapter !== undefined) {
    return { at, chapter: Number(chapter) };
  }
  return { at: 'end' };
}

/** The import entries for the drafts the writer kept, in their reviewed order. */
export function keptEntries(drafts: readonly DraftEntry[]): BookImportEntry[] {
  return drafts
    .filter((draft) => draft.include)
    .map((draft) => ({
      title: draft.title.trim(),
      markdown: draft.markdown,
      kind: draft.kind,
      origin: draft.origin,
      conversionNotes: draft.conversionNotes,
      ...(draft.kind === 'chapter' && draft.numbered === false ? { numbered: false } : {}),
      ...(draft.kind === 'chapter' && draft.author !== undefined ? { author: draft.author } : {}),
      ...(draft.kind === 'chapter' && draft.placement !== 'end'
        ? { placement: placementOf(draft.placement) }
        : {}),
    }));
}

/** Conversion notes to show above the list, each with its file. */
export function previewNotes(
  preview: Pick<BookImportPreview, 'entries' | 'origin' | 'conversionNotes'>,
  fileName: string,
): string[] {
  const notes = preview.conversionNotes.map((note) => `${fileName}: ${note}`);
  for (const entry of preview.entries) {
    if (entry.origin === undefined) continue;
    const label = entry.origin.type === 'file' ? entry.origin.fileName : fileName;
    for (const note of entry.conversionNotes ?? []) notes.push(`${label}: ${note}`);
  }
  return [...new Set(notes)];
}
