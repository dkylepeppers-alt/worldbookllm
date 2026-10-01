import type { SkillDetail, SkillMetadata } from '@worldbookllm/shared';
import { type FormEvent, useCallback, useEffect, useState } from 'react';

import { ApiClientError } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { ErrorState, LoadingState } from '../components/RequestState.js';
import { clearDraft, readDraft, useStoredDraft, writeDraft } from '../drafts.js';
import { StorySkillsInstall } from '../agent/StorySkillsInstall.js';

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

function skillDraftKey(id: string | null): string {
  return `skill:${id ?? 'new'}`;
}

function draftOf(skill: SkillDetail): Draft {
  return { name: skill.name, description: skill.description, content: skill.content };
}

function sameDraft(a: Draft, b: Draft): boolean {
  return a.name === b.name && a.description === b.description && a.content === b.content;
}

function originLabel(skill: SkillMetadata): string {
  if (skill.origin.type === 'bundled') {
    return skill.license === null ? 'Starter' : `Starter · ${skill.license}`;
  }
  if (skill.origin.type === 'story-skills') {
    return skill.license === null
      ? skill.origin.package
      : `${skill.origin.package} · ${skill.license}`;
  }
  return 'Custom';
}

export function SkillsPage() {
  const api = useApi();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [reload, setReload] = useState(0);
  // The open editor (a skill's id, or 'new'), kept so it is still there after
  // visiting another page. Unsaved edits are kept per skill.
  const [open, setOpen] = useStoredDraft<string | null>('skills:open', null);
  const selectedId = open === 'new' ? null : open;
  const creating = open === 'new';
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [draft, setDraft] = useState<Draft | null>(() =>
    open === 'new' ? (readDraft<Draft>(skillDraftKey(null)) ?? { ...NEW_SKILL }) : null,
  );
  const [restored, setRestored] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<SkillMetadata | null>(null);

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
        const kept = readDraft<Draft>(skillDraftKey(skill.id));
        setDetail(skill);
        setDraft(kept ?? draftOf(skill));
        setRestored(kept !== undefined && !sameDraft(kept, draftOf(skill)));
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        // A skill remembered as open may have been deleted since.
        if (caught instanceof ApiClientError && caught.status === 404) setOpen(null);
        else setError(errorMessage(caught, 'Could not load the skill.'));
      });
    return () => controller.abort();
  }, [api, selectedId, reload, setOpen]);

  // Keep unsaved edits per skill; an editor matching what is saved keeps nothing.
  useEffect(() => {
    if (draft === null) return;
    if (creating) {
      if (sameDraft(draft, NEW_SKILL)) clearDraft(skillDraftKey(null));
      else writeDraft(skillDraftKey(null), draft);
    } else if (detail !== null && detail.id === selectedId) {
      if (sameDraft(draft, draftOf(detail))) clearDraft(skillDraftKey(detail.id));
      else writeDraft(skillDraftKey(detail.id), draft);
    }
  }, [draft, creating, detail, selectedId]);

  const refresh = useCallback(() => setReload((value) => value + 1), []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (draft === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (creating) {
        const created = await api.createSkill(draft);
        clearDraft(skillDraftKey(null));
        setDraft(null);
        setOpen(created.id);
      } else if (detail !== null) {
        await api.updateSkill(detail.id, draft);
        clearDraft(skillDraftKey(detail.id));
      }
      setRestored(false);
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
      clearDraft(skillDraftKey(deleting.id));
      if (selectedId === deleting.id) {
        setOpen(null);
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
        Craft instructions the book agent loads when a request calls for them: planning, drafting,
        revision, continuity. Each skill is a Markdown file in your data directory, yours to edit,
        and a custom agent can be limited to some of them.
      </p>
      <div className="preset-toolbar">
        <button
          type="button"
          className="button-primary"
          onClick={() => {
            const kept = readDraft<Draft>(skillDraftKey(null));
            setOpen('new');
            setDetail(null);
            setDraft(kept ?? { ...NEW_SKILL });
            setRestored(kept !== undefined);
          }}
        >
          New skill
        </button>
        <StorySkillsInstall onInstalled={refresh} />
      </div>
      {error === null ? null : <p role="alert">{error}</p>}
      <div className="preset-studio-grid">
        <section className="preset-library" aria-label="Skill library">
          <h2>Library</h2>
          {skills.length === 0 ? (
            <p className="empty-inline">No skills yet. Install Story Skills or create your own.</p>
          ) : (
            <ul>
              {skills.map((skill) => (
                <li key={skill.id}>
                  <button
                    type="button"
                    className={skill.id === selectedId ? 'active' : undefined}
                    onClick={() => {
                      // Drop the previous skill's editor immediately so Save
                      // and Delete can never act on A while B is loading.
                      if (skill.id !== selectedId) {
                        setDetail(null);
                        setDraft(null);
                      }
                      setOpen(skill.id);
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
            {restored ? (
              <p className="change-note" role="status">
                Your unsaved changes were restored.{' '}
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setDraft(creating || detail === null ? { ...NEW_SKILL } : draftOf(detail));
                    setRestored(false);
                  }}
                >
                  Discard them
                </button>
              </p>
            ) : null}
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
                    clearDraft(skillDraftKey(null));
                    setOpen(null);
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
            This removes the skill and its files from your data directory. Custom agents that chose
            it will no longer see it.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
