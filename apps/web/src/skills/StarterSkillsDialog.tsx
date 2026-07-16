import type { StarterSkill } from '@worldbookllm/shared';
import { useEffect, useRef, useState } from 'react';

import { ApiClientError } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { useDialogLifecycle } from '../components/useDialogLifecycle.js';

interface StarterSkillsDialogProps {
  onClose: () => void;
  onInstalled: () => void;
}

type CatalogState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; starters: StarterSkill[] };

/**
 * One-click install of the vendored starter skill catalog (fiction craft
 * skills from jwynia/agent-skills, MIT licensed). Already-installed starters
 * stay checked and disabled; installs are idempotent server-side.
 */
export function StarterSkillsDialog({ onClose, onInstalled }: StarterSkillsDialogProps) {
  const api = useApi();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [catalog, setCatalog] = useState<CatalogState>({ status: 'loading' });
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useDialogLifecycle(closeRef, () => {
    if (!busy) onClose();
  });

  useEffect(() => {
    const controller = new AbortController();
    api
      .listStarterSkills(controller.signal)
      .then((starters) => {
        setCatalog({ status: 'ready', starters });
        setChecked(
          new Set(
            starters
              .filter((starter) => !starter.installed)
              .map((starter) => starter.starterId),
          ),
        );
      })
      .catch((caught: unknown) => {
        if (!(caught instanceof DOMException && caught.name === 'AbortError'))
          setCatalog({ status: 'error' });
      });
    return () => controller.abort();
  }, [api]);

  async function install() {
    if (busy || checked.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      await api.installStarterSkills([...checked]);
      onInstalled();
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : 'Could not install the skills.',
      );
      setBusy(false);
    }
  }

  function toggle(starterId: string) {
    const next = new Set(checked);
    if (next.has(starterId)) next.delete(starterId);
    else next.add(starterId);
    setChecked(next);
  }

  return (
    <div className="dialog-backdrop">
      <section
        className="dialog-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="starter-skills-title"
      >
        <p className="coordinate-label">Starter catalog</p>
        <h2 id="starter-skills-title">Install starter skills</h2>
        <p className="dialog-copy">
          Fiction craft skills from{' '}
          <a href="https://github.com/jwynia/agent-skills" target="_blank" rel="noreferrer">
            jwynia/agent-skills
          </a>
          , MIT license. Installed skills become editable Markdown files in your library.
        </p>
        {catalog.status === 'loading' ? <p className="empty-inline">Loading catalog…</p> : null}
        {catalog.status === 'error' ? (
          <p role="alert">The starter catalog could not be loaded.</p>
        ) : null}
        {catalog.status === 'ready' ? (
          <ul className="source-selector-list" aria-label="Starter skills">
            {catalog.starters.map((starter) => (
              <li key={starter.starterId}>
                <label title={starter.description}>
                  <input
                    type="checkbox"
                    checked={starter.installed || checked.has(starter.starterId)}
                    disabled={starter.installed || busy}
                    onChange={() => toggle(starter.starterId)}
                  />
                  {starter.name}
                  {starter.installed ? <small> — installed</small> : null}
                </label>
              </li>
            ))}
          </ul>
        ) : null}
        {error === null ? null : <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button
            ref={closeRef}
            type="button"
            className="button-secondary"
            disabled={busy}
            onClick={onClose}
          >
            Close
          </button>
          <button
            type="button"
            className="button-primary"
            disabled={busy || catalog.status !== 'ready' || checked.size === 0}
            onClick={() => void install()}
          >
            {busy ? 'Installing…' : `Install ${checked.size} skills`}
          </button>
        </div>
      </section>
    </div>
  );
}
