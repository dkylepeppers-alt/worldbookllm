import type { Checkpoint } from '@worldbookllm/shared';

interface ChangeSummaryProps {
  checkpoint: Checkpoint;
  /**
   * Only the book's newest live checkpoint can be undone (undo is
   * last-in-first-out); a turn still running offers no undo yet.
   */
  undo: 'available' | 'blocked' | 'hidden';
  undoing: boolean;
  onOpenDiff: (path: string) => void;
  onUndo: () => void;
}

const CHANGE_LABELS: Record<Checkpoint['files'][number]['change'], string> = {
  created: 'new',
  modified: 'edited',
  deleted: 'deleted',
};

/** The files one agent turn changed, each opening its diff, with Undo turn. */
export function ChangeSummary({
  checkpoint,
  undo,
  undoing,
  onOpenDiff,
  onUndo,
}: ChangeSummaryProps) {
  const count = checkpoint.files.length;
  const undone = checkpoint.undoneAt !== null;
  return (
    <section
      className={`change-summary${undone ? ' change-summary-undone' : ''}`}
      aria-label="Changes this turn"
    >
      <p className="coordinate-label">
        Changed {count} {count === 1 ? 'file' : 'files'}
        {undone ? ' · undone' : ''}
      </p>
      <ul>
        {checkpoint.files.map((file) => (
          <li key={file.path}>
            <button type="button" onClick={() => onOpenDiff(file.path)}>
              <span className={`change-kind change-${file.change}`}>
                {CHANGE_LABELS[file.change]}
              </span>
              <span className="change-path">{file.path}</span>
            </button>
          </li>
        ))}
      </ul>
      {undone || undo === 'hidden' ? null : undo === 'available' ? (
        <button type="button" className="button-secondary" disabled={undoing} onClick={onUndo}>
          {undoing ? 'Undoing…' : 'Undo turn'}
        </button>
      ) : (
        <p className="change-note">
          The book changed after this turn. Undo later changes first from the Project tab.
        </p>
      )}
    </section>
  );
}
