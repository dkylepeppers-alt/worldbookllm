import type { BookEntityKind } from '@worldbookllm/shared';
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useApi } from '../api/useApi.js';
import { useBook } from './book-context.js';
import { fileHref, KIND_LABELS } from './book-sections.js';
import { errorMessage } from './useLoad.js';

interface AddEntityFormProps {
  kinds: readonly BookEntityKind[];
  /** Directory each kind lives in, to open the new file after `story add`. */
  directories: Readonly<Partial<Record<BookEntityKind, string>>>;
}

function toId(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/'/gu, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

/** Adds an entity with `story add`, then opens it. */
export function AddEntityForm({ kinds, directories }: AddEntityFormProps) {
  const api = useApi();
  const navigate = useNavigate();
  const { slug, reload } = useBook();
  const [kind, setKind] = useState<BookEntityKind>(kinds[0] ?? 'character');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '') {
      setError(`Enter a name for the ${KIND_LABELS[kind]?.toLowerCase() ?? kind}.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const outcome = await api.addBookEntity(slug, { kind, name: trimmed, options: {} });
      reload();
      setName('');
      const created = /: \.\/(.+\.md)$/u.exec(outcome.output)?.[1];
      const directory = directories[kind];
      const path = created ?? (directory ? `${directory}/${toId(trimmed)}.md` : null);
      if (path) await navigate(fileHref(slug, path));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="add-entity" onSubmit={(event) => void handleSubmit(event)}>
      {kinds.length > 1 ? (
        <label>
          Kind
          <select value={kind} onChange={(event) => setKind(event.target.value as BookEntityKind)}>
            {kinds.map((option) => (
              <option key={option} value={option}>
                {KIND_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label>
        {`New ${KIND_LABELS[kind]?.toLowerCase() ?? kind}`}
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={300} />
      </label>
      <button type="submit" className="button-primary" disabled={busy}>
        {busy ? 'Adding…' : 'Add'}
      </button>
      {error === null ? null : (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
