import type { BookEntityKind, BookFileDetail } from '@worldbookllm/shared';
import { BOOK_ENTITY_KINDS } from '@worldbookllm/shared';
import { type FormEvent, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Link, useNavigate, useParams } from 'react-router-dom';
import remarkGfm from 'remark-gfm';

import { ApiClientError } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { ErrorState, LoadingState } from '../components/RequestState.js';
import { useStoredDraft } from '../drafts.js';
import { useBook } from './book-context.js';
import { fileHref, KIND_LABELS } from './book-sections.js';
import { errorMessage, useLoad } from './useLoad.js';

function fieldValue(value: unknown): string {
  if (Array.isArray(value)) return value.length === 0 ? '—' : value.map(fieldValue).join(', ');
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** The Markdown after the frontmatter block, for reading. */
function bodyOf(content: string): string {
  const match = /^---\n[\s\S]*?\n---(?:\n|$)/u.exec(content);
  return match ? content.slice(match[0].length) : content;
}

function isEntityKind(kind: string): kind is BookEntityKind {
  return (BOOK_ENTITY_KINDS as readonly string[]).includes(kind);
}

/** One book file: its fields and text, a raw editor, and entity actions. */
export function BookFilePage() {
  const path = useParams()['*'] ?? '';
  const { slug } = useBook();
  const api = useApi();
  const file = useLoad((signal) => api.readBookFile(slug, path, signal), `${slug}/${path}`);

  if (file.status === 'loading') return <LoadingState>Reading {path}…</LoadingState>;
  if (file.status === 'error') {
    return (
      <ErrorState title="This file could not open" message={file.message} onRetry={file.reload} />
    );
  }
  return <FileView key={file.data.hash} file={file.data} onChanged={file.reload} />;
}

interface FileViewProps {
  file: BookFileDetail;
  onChanged: () => void;
}

/** Unsaved edits to a file, and the version of the file they started from. */
interface FileDraft {
  base: string;
  content: string;
}

function FileView({ file, onChanged }: FileViewProps) {
  const api = useApi();
  const navigate = useNavigate();
  const { slug, reload } = useBook();
  const [stored, setStored, restored] = useStoredDraft<FileDraft | null>(
    `book-file:${slug}:${file.path}`,
    null,
  );
  const [mode, setMode] = useState<'read' | 'edit' | 'rename'>(stored === null ? 'read' : 'edit');
  const draft = stored?.content ?? file.content;
  // Edits restored from before the file changed on disk; saving them replaces that version.
  const stale = stored !== null && stored.base !== file.hash;
  const setDraft = (content: string) =>
    setStored(content === file.content ? null : { base: stored?.base ?? file.hash, content });
  const [name, setName] = useState(file.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [removing, setRemoving] = useState(false);
  const entityKind = file.entityId !== null && isEntityKind(file.kind) ? file.kind : null;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.writeBookFile(slug, file.path, { content: draft, expectedHash: file.hash });
      setStored(null);
      reload();
      onChanged();
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.code === 'file_changed') setConflict(true);
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  async function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (entityKind === null || file.entityId === null) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await api.renameBookEntity(slug, entityKind, file.entityId, {
        name: name.trim(),
      });
      reload();
      const renamed = /: \.\/(.+\.md)$/u.exec(outcome.output)?.[1];
      if (renamed) await navigate(fileHref(slug, renamed), { replace: true });
      else onChanged();
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  async function remove() {
    if (entityKind === null || file.entityId === null) return;
    setBusy(true);
    try {
      await api.removeBookEntity(slug, entityKind, file.entityId);
      reload();
      await navigate(
        `/books/${slug}/${entityKind === 'chapter' || entityKind === 'scene' ? 'write' : 'bible'}`,
      );
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
      setRemoving(false);
    }
  }

  const fields = Object.entries(file.frontmatter ?? {});

  return (
    <article className="book-file" aria-labelledby="book-file-title">
      <header className="book-file-header">
        <p className="coordinate-label">{KIND_LABELS[file.kind] ?? file.kind}</p>
        <h2 id="book-file-title">{file.title}</h2>
        <p className="source-path">{file.path}</p>
        <div className="mode-switch" role="group" aria-label="File mode">
          <button type="button" aria-pressed={mode === 'read'} onClick={() => setMode('read')}>
            Read
          </button>
          <button type="button" aria-pressed={mode === 'edit'} onClick={() => setMode('edit')}>
            Edit
          </button>
          {entityKind !== null ? (
            <button
              type="button"
              aria-pressed={mode === 'rename'}
              onClick={() => setMode('rename')}
            >
              Rename
            </button>
          ) : null}
        </div>
        <Link
          className="ask-agent"
          to={`/books/${encodeURIComponent(slug)}/agent?about=${encodeURIComponent(file.path)}`}
        >
          Ask the agent about this file
        </Link>
      </header>

      {error === null ? null : (
        <div className="form-error" role="alert">
          <p>{error}</p>
          {conflict ? (
            <button
              type="button"
              className="button-secondary"
              onClick={() => {
                setStored(null);
                onChanged();
              }}
            >
              Load the version on disk
            </button>
          ) : null}
        </div>
      )}

      {mode === 'read' ? (
        <>
          {fields.length > 0 ? (
            <dl className="field-list">
              {fields.map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{fieldValue(value)}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <div className="markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{bodyOf(file.content)}</ReactMarkdown>
          </div>
        </>
      ) : null}

      {mode === 'edit' ? (
        <form className="source-editor" onSubmit={(event) => void save(event)}>
          <label htmlFor="book-file-editor">Markdown, including frontmatter</label>
          {stale ? (
            <p className="change-note" role="status">
              This file changed after you started editing it. Your unsaved edits are below; saving
              them replaces the current version.
            </p>
          ) : restored && stored !== null ? (
            <p className="change-note" role="status">
              Your unsaved edits were restored.
            </p>
          ) : null}
          <textarea
            id="book-file-editor"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={20}
          />
          <div className="dialog-actions">
            <button
              type="button"
              className="button-secondary"
              onClick={() => {
                setStored(null);
                setMode('read');
              }}
            >
              {stored === null ? 'Cancel' : 'Discard edits'}
            </button>
            <button type="submit" className="button-primary" disabled={busy || stored === null}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      ) : null}

      {mode === 'rename' && entityKind !== null ? (
        <form className="source-editor" onSubmit={(event) => void rename(event)}>
          <label htmlFor="book-file-name">New name</label>
          <input
            id="book-file-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={300}
          />
          <p className="dialog-copy">
            story rename updates the file name and every reference to it across the book.
          </p>
          <div className="dialog-actions">
            <button type="button" className="button-danger" onClick={() => setRemoving(true)}>
              Remove
            </button>
            <button type="submit" className="button-primary" disabled={busy || name.trim() === ''}>
              {busy ? 'Renaming…' : 'Save new name'}
            </button>
          </div>
        </form>
      ) : null}

      {removing ? (
        <ConfirmDialog
          title={`Remove ${file.title}?`}
          confirmLabel="Remove"
          busy={busy}
          busyLabel="Removing…"
          onCancel={() => setRemoving(false)}
          onConfirm={() => void remove()}
        >
          story remove deletes the file and scrubs references to it. You can undo this from the
          Project tab.
        </ConfirmDialog>
      ) : null}
    </article>
  );
}
