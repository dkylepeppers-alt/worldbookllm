import {
  BOOK_BUILD_FORMATS,
  PRINT_TRIM_SIZES,
  type BookBuildFormat,
  type CreateBookBuildInput,
} from '@worldbookllm/shared';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';

import { buildDownloadUrl } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { ErrorState, LoadingState } from '../components/RequestState.js';
import { useBook } from './book-context.js';
import { errorMessage, useLoad } from './useLoad.js';

const FORMAT_LABELS: Readonly<Record<BookBuildFormat, string>> = {
  epub: 'EPUB e-book',
  docx: 'Word document (DOCX)',
  markdown: 'Markdown manuscript',
  shunn: 'Shunn manuscript (Markdown)',
  html: 'HTML review copy',
  print: 'Print interior (HTML)',
  narration: 'Audiobook narration script',
  metadata: 'Retailer metadata sheet',
  fountain: 'Screenplay skeleton (Fountain)',
  twee: 'Twine story (Twee)',
  ink: 'ink story',
};

/** Twee and ink read chapter `choices`, which nothing else in a build does. */
function InteractiveHint({ slug }: { slug: string }) {
  return (
    <p id="build-format-hint">
      Each chapter becomes a passage, starting with the first. Until any chapter has choices, the
      chapters run in order; once one does, a chapter without choices is an ending. Set them up and
      pin the story&apos;s IFID on the{' '}
      <Link to={`/books/${encodeURIComponent(slug)}/branches/edit`}>Branches</Link> screen.
    </p>
  );
}

/** EPUB first: it is what most writers reach for. */
const FORMATS: readonly BookBuildFormat[] = [
  'epub',
  ...BOOK_BUILD_FORMATS.filter((format) => format !== 'epub'),
];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

/** `story build` from the Project tab: pick a format, build into dist/, download. */
export function BuildsSection() {
  const api = useApi();
  const { slug } = useBook();
  const builds = useLoad((signal) => api.listBuilds(slug, signal), slug);
  const [format, setFormat] = useState<BookBuildFormat>('epub');
  const [shunn, setShunn] = useState(false);
  const [trim, setTrim] = useState<(typeof PRINT_TRIM_SIZES)[number]>('5.5x8.5');
  const [stamp, setStamp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const interactive = format === 'twee' || format === 'ink';

  async function build(event: FormEvent) {
    event.preventDefault();
    const input: CreateBookBuildInput = { format };
    if (format === 'docx' && shunn) input.shunn = true;
    if (format === 'print') input.trim = trim;
    if (format === 'html' && stamp.trim() !== '') input.stamp = stamp.trim();
    setBusy(true);
    setError(null);
    setOutput(null);
    try {
      const result = await api.createBuild(slug, input);
      setOutput(result.output);
      builds.reload();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function remove(name: string) {
    setBusy(true);
    setError(null);
    try {
      await api.removeBuild(slug, name);
      builds.reload();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="builds-section" aria-labelledby="builds-heading">
      <h3 id="builds-heading">Build</h3>
      <p>
        Builds are disposable copies made from the chapters by <code>story build</code>. They are
        written to dist/ and are not part of the book's history.
      </p>
      <form className="add-entity" onSubmit={(event) => void build(event)}>
        <label>
          Format
          <select
            value={format}
            aria-describedby={interactive ? 'build-format-hint' : undefined}
            onChange={(event) => setFormat(event.target.value as BookBuildFormat)}
          >
            {FORMATS.map((value) => (
              <option key={value} value={value}>
                {FORMAT_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        {format === 'docx' ? (
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={shunn}
              onChange={(event) => setShunn(event.target.checked)}
            />
            Shunn manuscript format
          </label>
        ) : null}
        {format === 'print' ? (
          <label>
            Trim size
            <select
              value={trim}
              onChange={(event) => setTrim(event.target.value as (typeof PRINT_TRIM_SIZES)[number])}
            >
              {PRINT_TRIM_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {format === 'html' ? (
          <label>
            Build label (optional)
            <input
              value={stamp}
              maxLength={100}
              placeholder="feedback-round-2"
              onChange={(event) => setStamp(event.target.value)}
            />
          </label>
        ) : null}
        <button type="submit" className="button-primary" disabled={busy}>
          {busy ? 'Building…' : 'Build'}
        </button>
      </form>
      {interactive ? <InteractiveHint slug={slug} /> : null}
      {error === null ? null : (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {output === null ? null : (
        <pre className="build-output" role="status" aria-label="Build output">
          {output}
        </pre>
      )}

      {builds.status === 'loading' ? <LoadingState>Reading builds…</LoadingState> : null}
      {builds.status === 'error' ? (
        <ErrorState
          title="Builds could not load"
          message={builds.message}
          onRetry={builds.reload}
        />
      ) : null}
      {builds.status === 'ready' && builds.data.length > 0 ? (
        <ul className="entry-list" aria-label="Built files">
          {builds.data.map((file) => (
            <li key={file.name}>
              <a href={buildDownloadUrl(slug, file.name)} download={file.name}>
                {file.name}
              </a>
              <span className="coordinate-label">
                {formatSize(file.size)} · {formatTime(file.updatedAt)}
              </span>
              <button
                type="button"
                className="button-secondary"
                disabled={busy}
                aria-label={`Delete ${file.name}`}
                onClick={() => void remove(file.name)}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
