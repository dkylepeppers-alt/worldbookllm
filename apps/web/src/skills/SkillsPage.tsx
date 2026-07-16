import type { SkillDetail, SkillMetadata } from '@worldbookllm/shared';
import { type FormEvent, useCallback, useEffect, useState } from 'react';

import { ApiClientError } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { ErrorState, LoadingState } from '../components/RequestState.js';
import { StarterSkillsDialog } from './StarterSkillsDialog.js';

type LoadState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; skills: SkillMetadata[] };

interface Draft {
  name: string;
  description: string;
  content: string;
}

const NEW_SKILL: Draft = {
  name: 'new-skill',
  description: '',
  content: '',
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiClientError ? error.message : fallback;
}

function originLabel(skill: SkillMetadata): string {
  if (skill.origin.type === 'bundled') {
    return skill.license === null ? 'Starter' : `Starter · ${skill.license}`;
  }
  return 'Custom';
}

export function SkillsPage() {
  const api = useApi();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [reload, setReload] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<SkillMetadata | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    api
      .listSkills(controller.signal)
      .then((skills) => setState({ status: 'ready', skills }))
      .catch((caught: unknown) => {
        if (!(caught instanceof DOMException && caught.name === 'AbortError'))
          setState({ status: 'error' });
      });
    return () => controller.abort();
  }, [api, reload]);

  useEffect(() => {
    if (selectedId === null) return;
    const controller = new AbortController();
    api
      .getSkill(selectedId, controller.signal)
      .then((skill) => {
        setDetail(skill);
        setDraft({ name: skill.name, description: skill.description, content: skill.content });
      })
      .catch((caught: unknown) => {
        if (!(caught instanceof DOMException && caught.name === 'AbortError'))
          setError(errorMessage(caught, 'Could not load the skill.'));
      });
    return () => controller.abort();
  }, [api, selectedId, reload]);

  const refresh = useCallback(() => setReload((value) => value + 1), []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (draft === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (creating) {
        const created = await api.createSkill(draft);
        setCreating(false);
        setDraft(null);
        setSelectedId(created.id);
      } else if (detail !== null) {
        await api.updateSkill(detail.id, draft);
      }
      refresh();
    } catch (caught) {
      setError(errorMessage(caught, 'Could not save the skill.'));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (deleting === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteSkill(deleting.id);
      if (selectedId === deleting.id) {
        setSelectedId(null);
        setDetail(null);
        setDraft(null);
      }
      setDeleting(null);
      refresh();
    } catch (caught) {
      setError(errorMessage(caught, 'Could not delete the skill.'));
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  }

  if (state.status === 'loading') return <LoadingState>Charting skills…</LoadingState>;
  if (state.status === 'error') {
    return (
      <ErrorState
        title="Could not load skills"
        message="The skills library could not be loaded."
        onRetry={refresh}
      />
    );
  }

  const skills = state.skills;
  const editing = creating || (selectedId !== null && detail !== null);

  return (
    <div className="presets-page">
      <p className="coordinate-label">Craft library · {skills.length} skills</p>
      <h1>Skills</h1>
      <p className="page-intro">
        Reusable craft instructions the model can be given per chat — worldbuilding frameworks,
        character-voice guides, story diagnostics. Each skill is a Markdown file in your data
        directory, yours to edit.
      </p>
      <div className="preset-toolbar">
        <button
          type="button"
          className="button-primary"
          onClick={() => {
            setCreating(true);
            setSelectedId(null);
            setDraft({ ...NEW_SKILL });
          }}
        >
          New skill
        </button>
        <button type="button" className="button-secondary" onClick={() => setInstalling(true)}>
          Install starter skills
        </button>
      </div>
      {error === null ? null : <p role="alert">{error}</p>}
      <div className="preset-studio-grid">
        <section className="preset-library" aria-label="Skill library">
          <h2>Library</h2>
          {skills.length === 0 ? (
            <p className="empty-inline">
              No skills yet — install the starter set or create your own.
            </p>
          ) : (
            <ul>
              {skills.map((skill) => (
                <li key={skill.id}>
                  <button
                    type="button"
                    className={skill.id === selectedId ? 'active' : undefined}
                    onClick={() => {
                      setCreating(false);
                      // Drop the previous skill's editor immediately so Save
                      // and Delete can never act on A while B is loading.
                      if (skill.id !== selectedId) {
                        setDetail(null);
                        setDraft(null);
                      }
                      setSelectedId(skill.id);
                    }}
                  >
                    <strong>{skill.name}</strong>
                    <small>
                      {originLabel(skill)} · {skill.wordCount} words
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        {editing && draft !== null ? (
          <form className="preset-card preset-editor" onSubmit={(event) => void save(event)}>
            <h2>{creating ? 'New skill' : (detail?.name ?? '')}</h2>
            {creating || detail === null ? null : (
              <p className="coordinate-label">
                {originLabel(detail)} · updated {new Date(detail.updatedAt).toLocaleString()}
              </p>
            )}
            <label>
              Name
              <input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                title="Lowercase letters, numbers, and single hyphens"
                required
              />
            </label>
            <label>
              Description
              <textarea
                value={draft.description}
                rows={2}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                required
              />
            </label>
            <label>
              Instructions (Markdown)
              <textarea
                value={draft.content}
                rows={16}
                onChange={(event) => setDraft({ ...draft, content: event.target.value })}
                required
              />
            </label>
            <div className="preset-actions">
              <button type="submit" className="button-primary" disabled={busy}>
                {busy ? 'Saving…' : creating ? 'Create skill' : 'Save changes'}
              </button>
              {creating ? (
                <button
                  type="button"
                  className="button-secondary"
                  disabled={busy}
                  onClick={() => {
                    setCreating(false);
                    setDraft(null);
                  }}
                >
                  Cancel
                </button>
              ) : detail === null ? null : (
                <button
                  type="button"
                  className="button-danger"
                  disabled={busy}
                  onClick={() => setDeleting(detail)}
                >
                  Delete skill
                </button>
              )}
            </div>
          </form>
        ) : (
          <section className="preset-card">
            <h2>Select a skill</h2>
            <p className="empty-inline">
              Choose a skill from the library to view or edit its instructions.
            </p>
          </section>
        )}
      </div>
      {deleting === null ? null : (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          confirmLabel="Delete skill"
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void confirmDelete()}
        >
          <p>
            This removes the skill and its files from your data directory. Chats that attached it
            will need a new selection.
          </p>
        </ConfirmDialog>
      )}
      {installing ? (
        <StarterSkillsDialog
          onClose={() => setInstalling(false)}
          onInstalled={() => {
            setInstalling(false);
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}
