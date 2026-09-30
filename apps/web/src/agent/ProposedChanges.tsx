import type { AgentChangeset } from '@worldbookllm/shared';

interface ProposedChangesProps {
  changeset: AgentChangeset;
  /** A turn still running shows its proposal without actions yet. */
  running: boolean;
  /** The file being applied or skipped ('*' for all), while the request runs. */
  busy: string | null;
  onOpenDiff: (path: string) => void;
  onResolve: (action: 'apply' | 'skip', path?: string) => void;
}

const CHANGE_LABELS: Record<AgentChangeset['files'][number]['change'], string> = {
  created: 'new',
  modified: 'edited',
  deleted: 'deleted',
};

const STATUS_LABELS: Record<AgentChangeset['files'][number]['status'], string> = {
  pending: 'awaiting review',
  applied: 'applied',
  skipped: 'skipped',
};

/**
 * Review mode: the files a turn proposed to change. Each opens its diff and
 * can be applied or skipped; applied files join the book's history as one
 * undoable change per apply.
 */
export function ProposedChanges({
  changeset,
  running,
  busy,
  onOpenDiff,
  onResolve,
}: ProposedChangesProps) {
  const pending = changeset.files.filter((file) => file.status === 'pending');
  const count = changeset.files.length;
  return (
    <section className="change-summary proposed-changes" aria-label="Proposed changes">
      <p className="coordinate-label">
        Proposed {count} {count === 1 ? 'change' : 'changes'}
        {pending.length === 0 ? ' · reviewed' : ` · ${pending.length} awaiting review`}
      </p>
      <ul>
        {changeset.files.map((file) => (
          <li key={file.path} className={`proposed-${file.status}`}>
            <button type="button" onClick={() => onOpenDiff(file.path)}>
              <span className={`change-kind change-${file.change}`}>
                {CHANGE_LABELS[file.change]}
              </span>{' '}
              <span className="change-path">{file.path}</span>
            </button>
            {file.status === 'pending' && !running ? (
              <span className="proposed-actions">
                <button
                  type="button"
                  className="button-secondary"
                  disabled={busy !== null}
                  aria-label={`Apply ${file.path}`}
                  onClick={() => onResolve('apply', file.path)}
                >
                  {busy === file.path ? 'Applying…' : 'Apply'}
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy !== null}
                  aria-label={`Skip ${file.path}`}
                  onClick={() => onResolve('skip', file.path)}
                >
                  Skip
                </button>
              </span>
            ) : (
              <span className="proposed-status coordinate-label">{STATUS_LABELS[file.status]}</span>
            )}
          </li>
        ))}
      </ul>
      {pending.length > 1 && !running ? (
        <div className="proposed-all">
          <button
            type="button"
            className="button-primary"
            disabled={busy !== null}
            onClick={() => onResolve('apply')}
          >
            {busy === '*' ? 'Applying…' : 'Apply all'}
          </button>
          <button
            type="button"
            className="button-secondary"
            disabled={busy !== null}
            onClick={() => onResolve('skip')}
          >
            Skip all
          </button>
        </div>
      ) : null}
    </section>
  );
}
