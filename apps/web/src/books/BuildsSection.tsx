import {
  LINEAR_BUILD_FORMATS,
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
  ink: 'ink story for Inky (.ink)',
  'ink-json': 'Compiled ink for game engines (JSON)',
  web: 'Playable web page (HTML)',
};

/** What an interactive book's exports are for (ADR 0030). */
function InteractiveHint({ slug }: { slug: string }) {
  return (
    <p id="build-format-hint">
      An interactive book exports as ink: one <code>.ink</code> file that opens in Inky, the
      compiled story as JSON for ink's Unity, Godot, and web runtimes, or a single web page that
      plays the story with nothing else to install. Fix any problems{' '}
      <Link to={`/books/${encodeURIComponent(slug)}/health`}>Health</Link> lists first: a story that
      does not compile cannot be exported.
    </p>
  );
}

/** EPUB first: it is what most writers reach for. */
const LINEAR_FORMATS: readonly BookBuildFormat[] = [
  'epub',
  ...LINEAR_BUILD_FORMATS.filter((format) => format !== 'epub'),
];

/** The web page first: it is what a reader can open. */
const INTERACTIVE_FORMATS: readonly BookBuildFormat[] = ['web', 'ink', 'ink-json'];

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
  const { slug, tree } = useBook();
  const interactive = tree.book.interactive === true;
  const formats = interactive ? INTERACTIVE_FORMATS : LINEAR_FORMATS;
  const builds = useLoad((signal) => api.listBuilds(slug, signal), slug);
  const [format, setFormat] = useState<BookBuildFormat>(formats[0]!);
  const [shunn, setShunn] = useState(false);
  const [trim, setTrim] = useState<(typeof PRINT_TRIM_SIZES)[number]>('5.5x8.5');
  const [stamp, setStamp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);

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
            {formats.map((value) => (
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
