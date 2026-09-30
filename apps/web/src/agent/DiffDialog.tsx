import type { Checkpoint } from '@worldbookllm/shared';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { useBook } from '../books/book-context.js';
import { fileHref } from '../books/book-sections.js';
import { useLoad } from '../books/useLoad.js';
import { ErrorState, LoadingState } from '../components/RequestState.js';
import { useDialogLifecycle } from '../components/useDialogLifecycle.js';
import { lineDiff } from './line-diff.js';

export interface DiffFile {
  path: string;
  before: string | null;
  after: string | null;
}

interface DiffDialogProps {
  /** Names the change: a checkpoint's label, or the proposal it came from. */
  label: string;
  files: ReadonlyArray<Pick<Checkpoint['files'][number], 'path' | 'change'>>;
  path: string;
  /** Identifies what `load` fetches, so it reloads only when that changes. */
  loadKey: string;
  load: (signal: AbortSignal) => Promise<readonly DiffFile[]>;
  /** Whether "Open file" makes sense: the file exists in the book as shown. */
  canOpen: (path: string) => boolean;
  onClose: () => void;
}

const MARKS = { same: ' ', add: '+', del: '−' } as const;

/** One file's before and after in a change, as a folded line diff. */
export function DiffDialog({
  label,
  files,
  path,
  loadKey,
  load,
  canOpen,
  onClose,
}: DiffDialogProps) {
  const { slug } = useBook();
  const closeRef = useRef<HTMLButtonElement>(null);
  useDialogLifecycle(closeRef, onClose);
  const [selected, setSelected] = useState(path);
  const detail = useLoad(load, loadKey);
  const file =
    detail.status === 'ready' ? detail.data.find((entry) => entry.path === selected) : null;

  return (
    <div className="dialog-backdrop">
      <section
        className="dialog-card diff-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="diff-dialog-title"
      >
        <p className="coordinate-label">{label}</p>
        <h2 id="diff-dialog-title">{selected}</h2>
        {files.length > 1 ? (
          <label className="diff-file-select">
            File
            <select value={selected} onChange={(event) => setSelected(event.target.value)}>
              {files.map((entry) => (
                <option key={entry.path} value={entry.path}>
                  {entry.path}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {detail.status === 'loading' ? <LoadingState>Comparing versions…</LoadingState> : null}
        {detail.status === 'error' ? (
          <ErrorState
            title="The change could not load"
            message={detail.message}
            onRetry={detail.reload}
          />
        ) : null}
        {file === undefined ? <p className="dialog-copy">This file is not in the change.</p> : null}
        {file ? (
          <ol className="diff-lines" aria-label={`Changes to ${selected}`}>
            {lineDiff(file.before, file.after).map((line, index) =>
              line.kind === 'skip' ? (
                <li key={index} className="diff-skip">
                  {line.count} unchanged {line.count === 1 ? 'line' : 'lines'}
                </li>
              ) : (
                <li key={index} className={`diff-${line.kind}`}>
                  <span className="diff-mark" aria-hidden="true">
                    {MARKS[line.kind]}
                  </span>
                  {line.kind === 'same' ? null : (
                    <span className="visually-hidden">
                      {line.kind === 'add' ? 'Added: ' : 'Removed: '}
                    </span>
                  )}
                  <span className="diff-text">{line.text}</span>
                </li>
              ),
            )}
          </ol>
        ) : null}
        <div className="dialog-actions">
          {!canOpen(selected) ? null : (
            <Link className="button-secondary" to={fileHref(slug, selected)} onClick={onClose}>
              Open file
            </Link>
          )}
          <button ref={closeRef} type="button" className="button-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </section>
    </div>
  );
}
