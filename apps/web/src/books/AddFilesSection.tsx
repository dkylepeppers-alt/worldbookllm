import {
  BOOK_IMPORT_KINDS,
  type BookImportKind,
  type BookImportPreview,
  type SourceOrigin,
} from '@worldbookllm/shared';
import { type ChangeEvent, useState } from 'react';

import { useApi } from '../api/useApi.js';
import { useBook } from './book-context.js';
import { KIND_LABELS } from './book-sections.js';
import { errorMessage } from './useLoad.js';

/** Chapters first: adding manuscript files is the common case. */
const KINDS: readonly BookImportKind[] = [
  'chapter',
  ...BOOK_IMPORT_KINDS.filter((kind) => kind !== 'chapter'),
];

const ACCEPT =
  '.md,.markdown,.txt,.html,.htm,.pdf,.json,.zip,text/markdown,text/plain,text/html,application/pdf,application/json,application/zip';

interface DraftEntry {
  key: string;
  include: boolean;
  title: string;
  kind: BookImportKind;
  markdown: string;
  origin: SourceOrigin;
  /** Where the entry came from, as shown in the list. */
  source: string;
}

function sourceLabel(origin: SourceOrigin, fallback: string): string {
  return origin.type === 'file' ? origin.fileName : fallback;
}

/**
 * Adds files to the book: Markdown, text, HTML, PDF, lorebooks, or a zip of
 * them. Each file is converted for review first; nothing is written until the
 * writer adds the entries they keep, as one undoable change.
 */
export function AddFilesSection() {
  const api = useApi();
  const { slug, reload } = useBook();
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
      readNotes.push(...preview.conversionNotes.map((note) => `${file.name}: ${note}`));
      preview.entries.forEach((entry, index) => {
        const origin = entry.origin ?? preview.origin;
        read.push({
          key: `${file.name}:${index}:${entries.length + read.length}`,
          include: true,
          title: entry.title,
          kind: entry.suggestedKind,
          markdown: entry.markdown,
          origin,
          source: sourceLabel(origin, file.name),
        });
      });
    }
    setEntries((current) => [...current, ...read]);
    setNotes((current) => [...current, ...readNotes]);
    if (failed.length > 0) setError(failed.join('\n'));
    setBusy(null);
  }

  function update(key: string, change: Partial<DraftEntry>) {
    setEntries((current) =>
      current.map((entry) => (entry.key === key ? { ...entry, ...change } : entry)),
    );
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
        entries: kept.map((entry) => ({
          title: entry.title.trim(),
          markdown: entry.markdown,
          kind: entry.kind,
          origin: entry.origin,
        })),
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
        Add chapters, notes, or bible entries from Markdown, text, HTML, PDF, or a zip of them.
        Review each one before it is written; the whole addition is one change you can undo.
        Chapters go after the book's last chapter.
      </p>
      <label className="button-secondary file-button">
        {busy === 'reading' ? 'Reading…' : 'Choose files'}
        <input
          type="file"
          multiple
          accept={ACCEPT}
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
          <ol className="add-files-list" aria-label="Files to add">
            {entries.map((entry) => (
              <li key={entry.key}>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={entry.include}
                    onChange={(event) => update(entry.key, { include: event.target.checked })}
                  />
                  Add
                </label>
                <label>
                  Title
                  <input
                    value={entry.title}
                    maxLength={200}
                    disabled={!entry.include}
                    onChange={(event) => update(entry.key, { title: event.target.value })}
                  />
                </label>
                <label>
                  As
                  <select
                    value={entry.kind}
                    disabled={!entry.include}
                    onChange={(event) =>
                      update(entry.key, { kind: event.target.value as BookImportKind })
                    }
                  >
                    {KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {KIND_LABELS[kind] ?? kind}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="coordinate-label">{entry.source}</span>
                <details>
                  <summary>Review text</summary>
                  <textarea
                    aria-label={`Text of ${entry.title}`}
                    value={entry.markdown}
                    rows={10}
                    disabled={!entry.include}
                    onChange={(event) => update(entry.key, { markdown: event.target.value })}
                  />
                </details>
              </li>
            ))}
          </ol>
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
