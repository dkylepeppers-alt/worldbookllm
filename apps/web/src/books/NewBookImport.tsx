import {
  IMPORT_LANGUAGES,
  STORY_TENSES,
  type ManuscriptImportResult,
  type NewBookImportPreview,
} from '@worldbookllm/shared';
import { type FormEvent, useEffect, useState } from 'react';

import { useApi } from '../api/useApi.js';
import { LoadingState } from '../components/RequestState.js';
import {
  type DraftEntry,
  IMPORT_KINDS,
  draftsFromPreview,
  keptEntries,
  previewNotes,
} from './import-review.js';
import { ImportReviewList } from './ImportReviewList.js';
import { errorMessage } from './useLoad.js';

/** story-skills book forms; the CLI sets a word target for each. */
const FORMS = [
  'novel',
  'novella',
  'novelette',
  'short-story',
  'flash',
  'serial',
  'picture-book',
  'chapter-book',
] as const;

const POVS = [
  'first-person',
  'second-person',
  'third-person-limited',
  'third-person-omniscient',
] as const;

const LANGUAGE_LABELS: Readonly<Record<(typeof IMPORT_LANGUAGES)[number], string>> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
};

interface NewBookImportProps {
  file: File;
  onCancel: () => void;
  onCreated: (result: ManuscriptImportResult) => void;
}

/**
 * A new book from an upload, reviewed before anything is written (ADR 0026).
 * The manuscript is split into chapters as `story import` splits it, notes
 * and bible entries get their kinds, and the writer sets the book's form,
 * genre, POV, and tense, then creates it as one undoable change. A zipped
 * story-skills project is imported whole instead.
 */
export function NewBookImport({ file, onCancel, onCreated }: NewBookImportProps) {
  const api = useApi();
  const [language, setLanguage] = useState<(typeof IMPORT_LANGUAGES)[number]>('en');
  const [preview, setPreview] = useState<NewBookImportPreview | null>(null);
  const [entries, setEntries] = useState<DraftEntry[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [form, setForm] = useState('');
  const [genre, setGenre] = useState('');
  const [pov, setPov] = useState('');
  const [tense, setTense] = useState('');
  const [targetWords, setTargetWords] = useState('');
  const [synopsis, setSynopsis] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    api
      .previewNewBook(file, language === 'en' ? undefined : language, controller.signal)
      .then((read) => {
        setPreview(read);
        setTitle((current) => (current === '' ? read.title : current));
        if (read.kind === 'documents') {
          setEntries(draftsFromPreview(read, file.name, IMPORT_KINDS));
          setNotes(previewNotes(read, file.name));
        }
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [api, file, language]);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (preview === null) return;
    setBusy(true);
    setError(null);
    try {
      if (preview.kind === 'project') {
        onCreated(await api.importManuscript(file));
        return;
      }
      const kept = keptEntries(entries);
      if (kept.length === 0) throw new Error('Keep at least one entry.');
      if (kept.some((entry) => entry.title === '')) throw new Error('Give every entry a title.');
      const target = Number(targetWords);
      onCreated(
        await api.createImportedBook({
          title: title.trim() || preview.title,
          ...(form ? { form } : {}),
          ...(genre.trim() ? { genre: genre.trim() } : {}),
          ...(pov ? { pov } : {}),
          ...(tense ? { tense: tense as (typeof STORY_TENSES)[number] } : {}),
          ...(synopsis.trim() ? { synopsis: synopsis.trim() } : {}),
          ...(targetWords !== '' && Number.isInteger(target) && target > 0
            ? { targetWords: target }
            : {}),
          ...(language === 'en' ? {} : { language }),
          import: { origin: preview.origin, conversionNotes: [], entries: kept },
          candidates: preview.candidates,
          skipped: preview.skipped,
        }),
      );
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  const chapters = entries.filter((entry) => entry.include && entry.kind === 'chapter').length;
  const others = entries.filter((entry) => entry.include && entry.kind !== 'chapter').length;

  return (
    <section className="new-book-import" aria-labelledby="new-book-import-heading">
      <p className="coordinate-label">Import · {file.name}</p>
      <h2 id="new-book-import-heading">Review the new book</h2>
      {loading ? <LoadingState>Reading {file.name}…</LoadingState> : null}
      {error === null ? null : (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {preview?.kind === 'project' && !loading ? (
        <form className="add-entity" onSubmit={(event) => void create(event)}>
          <p>
            This zip is a whole story-skills project: <strong>{preview.title}</strong>, with{' '}
            {preview.files} {preview.files === 1 ? 'file' : 'files'}. It is imported as it is, then
            validated.
          </p>
          {preview.skipped.length === 0 ? null : (
            <ul className="add-files-notes" aria-label="Skipped files">
              {preview.skipped.map((entry) => (
                <li key={entry}>{entry}</li>
              ))}
            </ul>
          )}
          <div className="add-files-actions">
            <button type="submit" className="button-primary" disabled={busy}>
              {busy ? 'Importing…' : 'Import the project'}
            </button>
            <button type="button" className="button-secondary" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {preview?.kind === 'documents' && !loading ? (
        <form className="new-book-import-form" onSubmit={(event) => void create(event)}>
          <fieldset className="new-book-settings">
            <legend>The book</legend>
            <label>
              Title
              <input
                value={title}
                maxLength={300}
                required
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label>
              Form
              <select value={form} onChange={(event) => setForm(event.target.value)}>
                <option value="">Not set</option>
                {FORMS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Word target
              <input
                type="number"
                min={1}
                inputMode="numeric"
                value={targetWords}
                placeholder="From the form"
                onChange={(event) => setTargetWords(event.target.value)}
              />
            </label>
            <label>
              Genre
              <input
                value={genre}
                maxLength={100}
                placeholder="mystery"
                onChange={(event) => setGenre(event.target.value)}
              />
            </label>
            <label>
              Point of view
              <select value={pov} onChange={(event) => setPov(event.target.value)}>
                <option value="">Not set</option>
                {POVS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tense
              <select value={tense} onChange={(event) => setTense(event.target.value)}>
                <option value="">Not set</option>
                {STORY_TENSES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Chapter headings in
              <select
                value={language}
                onChange={(event) => {
                  // Headings in another language split differently: read the file again.
                  setLoading(true);
                  setError(null);
                  setLanguage(event.target.value as (typeof IMPORT_LANGUAGES)[number]);
                }}
              >
                {IMPORT_LANGUAGES.map((value) => (
                  <option key={value} value={value}>
                    {LANGUAGE_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className="new-book-synopsis">
              Synopsis
              <textarea
                value={synopsis}
                rows={3}
                maxLength={2000}
                placeholder="Two or three sentences. You can add it later."
                onChange={(event) => setSynopsis(event.target.value)}
              />
            </label>
          </fieldset>

          {notes.length === 0 && preview.skipped.length === 0 ? null : (
            <ul className="add-files-notes" aria-label="Conversion notes">
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
              {preview.skipped.map((entry) => (
                <li key={entry}>Skipped {entry}</li>
              ))}
            </ul>
          )}

          <h3>
            {chapters} {chapters === 1 ? 'chapter' : 'chapters'}
            {others > 0
              ? `, ${others} ${others === 1 ? 'note or entry' : 'notes and entries'}`
              : ''}
          </h3>
          <ImportReviewList
            label="Import entries"
            entries={entries}
            onChange={setEntries}
            kinds={IMPORT_KINDS}
          />

          {preview.candidates.length === 0 ? null : (
            <section aria-labelledby="import-candidates-heading">
              <h3 id="import-candidates-heading">Suggested characters and places</h3>
              <p>
                Names the manuscript repeats. They are saved in the book as an import report, for
                you or the agent to turn into bible entries.
              </p>
              <ul className="import-candidates">
                {preview.candidates.map((candidate) => (
                  <li key={candidate.name}>
                    {candidate.name} <span className="coordinate-label">{candidate.count}×</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="add-files-actions">
            <button type="submit" className="button-primary" disabled={busy}>
              {busy ? 'Creating…' : 'Create the book'}
            </button>
            <button type="button" className="button-secondary" disabled={busy} onClick={onCancel}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {preview === null && !loading ? (
        <button type="button" className="button-secondary" onClick={onCancel}>
          Back
        </button>
      ) : null}
    </section>
  );
}
