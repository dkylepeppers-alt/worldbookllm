import type { BookImportKind } from '@worldbookllm/shared';

import { KIND_LABELS } from './book-sections.js';
import type { ChapterSlot, DraftEntry } from './import-review.js';

interface ImportReviewListProps {
  label: string;
  entries: readonly DraftEntry[];
  onChange: (entries: DraftEntry[]) => void;
  kinds: readonly BookImportKind[];
  /** The book's chapters, when chapters can go before or replace one of them. */
  chapters?: readonly ChapterSlot[];
}

/**
 * The review list every import shares (ADR 0026): keep or drop each entry,
 * retitle it, choose what it becomes, put it in order, place a chapter, and
 * read or edit its text, all before anything is written.
 */
export function ImportReviewList({
  label,
  entries,
  onChange,
  kinds,
  chapters,
}: ImportReviewListProps) {
  function update(key: string, change: Partial<DraftEntry>) {
    onChange(entries.map((entry) => (entry.key === key ? { ...entry, ...change } : entry)));
  }

  function move(index: number, by: -1 | 1) {
    const next = [...entries];
    const [entry] = next.splice(index, 1);
    next.splice(index + by, 0, entry!);
    onChange(next);
  }

  return (
    <ol className="add-files-list" aria-label={label}>
      {entries.map((entry, index) => (
        <li key={entry.key}>
          <div className="import-entry-head">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={entry.include}
                onChange={(event) => update(entry.key, { include: event.target.checked })}
              />
              Add
            </label>
            <span className="coordinate-label">{String(index + 1).padStart(2, '0')}</span>
            <div className="import-entry-order">
              <button
                type="button"
                className="text-button"
                aria-label={`Move ${entry.title} up`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="text-button"
                aria-label={`Move ${entry.title} down`}
                disabled={index === entries.length - 1}
                onClick={() => move(index, 1)}
              >
                ↓
              </button>
            </div>
          </div>
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
              {kinds.map((kind) => (
                <option key={kind} value={kind}>
                  {KIND_LABELS[kind] ?? kind}
                </option>
              ))}
            </select>
          </label>
          {entry.kind === 'chapter' && chapters !== undefined && chapters.length > 0 ? (
            <label>
              Place
              <select
                value={entry.placement}
                disabled={!entry.include}
                onChange={(event) => update(entry.key, { placement: event.target.value })}
              >
                <option value="end">After the last chapter</option>
                <optgroup label="Before">
                  {chapters.map((chapter) => (
                    <option key={`before:${chapter.number}`} value={`before:${chapter.number}`}>
                      Before {chapter.number}: {chapter.title}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Replace the text of">
                  {chapters.map((chapter) => (
                    <option key={`replace:${chapter.number}`} value={`replace:${chapter.number}`}>
                      Replace {chapter.number}: {chapter.title}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
          ) : null}
          {entry.kind === 'chapter' && entry.numbered === false ? (
            <span className="coordinate-label">Unnumbered, headed by its title</span>
          ) : null}
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
  );
}
