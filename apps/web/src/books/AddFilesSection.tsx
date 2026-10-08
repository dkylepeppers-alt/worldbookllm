import type { BookImportPreview } from '@worldbookllm/shared';
import { type ChangeEvent, useState } from 'react';

import { useApi } from '../api/useApi.js';
import { useBook } from './book-context.js';
import {
  type ChapterSlot,
  type DraftEntry,
  IMPORT_ACCEPT,
  IMPORT_KINDS,
  draftsFromPreview,
  keptEntries,
  previewNotes,
} from './import-review.js';
import { ImportReviewList } from './ImportReviewList.js';
import { errorMessage } from './useLoad.js';

/**
 * Adds files to the book: Markdown, text, HTML, PDF, lorebooks, or a zip of
 * them. Each file is converted for review first; nothing is written until the
 * writer adds the entries they keep, as one undoable change.
 */
export function AddFilesSection() {
  const api = useApi();
  const { slug, tree, reload } = useBook();
  // A series bible holds shared canon, never chapters.
  const kinds =
    tree.book.kind === 'book' ? IMPORT_KINDS : IMPORT_KINDS.filter((kind) => kind !== 'chapter');
  const chapters: ChapterSlot[] = tree.files
    .flatMap((file) => {
      const number = /^chapter-(\d+)$/u.exec(file.entityId ?? '')?.[1];
      return file.kind === 'chapter' && number !== undefined
        ? [{ number: Number(number), title: file.title }]
        : [];
    })
    .sort((left, right) => left.number - right.number);
  const [entries, setEntries] = useState<DraftEntry[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [busy, setBusy] = useState<'reading' | 'adding' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    if (files.length === 0) return;
    setBusy('reading');
    setError(null);
    setResult(null);
    const read: DraftEntry[] = [];
    const readNotes: string[] = [];
    const failed: string[] = [];
    for (const file of files) {
      let preview: BookImportPreview;
      try {
        preview = await api.previewBookImport(slug, file);
      } catch (caught) {
        failed.push(`${file.name}: ${errorMessage(caught)}`);
        continue;
      }
      readNotes.push(...previewNotes(preview, file.name));
      read.push(...draftsFromPreview(preview, file.name, kinds));
    }
    setEntries((current) => [...current, ...read]);
    setNotes((current) => [...current, ...readNotes]);
    if (failed.length > 0) setError(failed.join('\n'));
    setBusy(null);
  }

  function clear() {
    setEntries([]);
    setNotes([]);
    setError(null);
  }

  const kept = entries.filter((entry) => entry.include);

  async function add() {
    const first = kept[0];
    if (first === undefined) return;
    if (kept.some((entry) => entry.title.trim() === '')) {
      setError('Give every entry a title.');
      return;
    }
    setBusy('adding');
    setError(null);
    try {
      const imported = await api.importBookEntries(slug, {
        origin: first.origin,
        conversionNotes: [],
        entries: keptEntries(entries),
      });
      const findings = imported.validation?.diagnostics.length ?? 0;
      setResult(
        `Added ${imported.files.length} ${imported.files.length === 1 ? 'file' : 'files'}: ${imported.files.join(', ')}.` +
          (findings > 0 ? ` story validate reported ${findings}; see the Health tab.` : ''),
      );
      clear();
      reload();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="add-files-section" aria-labelledby="add-files-heading">
      <h3 id="add-files-heading">Add files</h3>
      <p>
        Add chapters, notes, or bible entries from Markdown, text, HTML, PDF, or a zip of them. A
        file with several chapter headings is split into chapters. Review each entry, and place
        chapters at the end, before a chapter, or in place of a chapter's text; the whole addition
        is one change you can undo.
      </p>
      <label className="button-secondary file-button">
        {busy === 'reading' ? 'Reading…' : 'Choose files'}
        <input
          type="file"
          multiple
          accept={IMPORT_ACCEPT}
          disabled={busy !== null}
          onChange={(event) => void choose(event)}
        />
      </label>

      {error === null ? null : (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {result === null ? null : (
        <p className="build-output" role="status" aria-label="Added files">
          {result}
        </p>
      )}

      {entries.length === 0 ? null : (
        <>
          {notes.length === 0 ? null : (
            <ul className="add-files-notes" aria-label="Conversion notes">
              {notes.map((note, index) => (
                <li key={index}>{note}</li>
              ))}
            </ul>
          )}
          <ImportReviewList
            label="Files to add"
            entries={entries}
            onChange={setEntries}
            kinds={kinds}
            chapters={chapters}
          />
          <div className="add-files-actions">
            <button
              type="button"
              className="button-primary"
              disabled={busy !== null || kept.length === 0}
              onClick={() => void add()}
            >
              {busy === 'adding'
                ? 'Adding…'
                : `Add ${kept.length} ${kept.length === 1 ? 'entry' : 'entries'} to the book`}
            </button>
            <button
              type="button"
              className="button-secondary"
              disabled={busy !== null}
              onClick={clear}
            >
              Discard
            </button>
          </div>
        </>
      )}
    </section>
  );
}
