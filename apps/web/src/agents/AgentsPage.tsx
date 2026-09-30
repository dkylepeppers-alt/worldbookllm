import type { CustomAgent, SkillMetadata } from '@worldbookllm/shared';
import { type FormEvent, useState } from 'react';

import { useApi } from '../api/useApi.js';
import { errorMessage, useLoad } from '../books/useLoad.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { ErrorState, LoadingState } from '../components/RequestState.js';

interface Draft {
  name: string;
  description: string;
  instructions: string;
  /** null allows every installed skill. */
  skills: string[] | null;
}

const NEW_AGENT: Draft = { name: '', description: '', instructions: '', skills: null };

function draftOf(agent: CustomAgent): Draft {
  return {
    name: agent.name,
    description: agent.description,
    instructions: agent.instructions,
    skills: agent.skills,
  };
}

function skillsLabel(agent: CustomAgent): string {
  if (agent.skills === null) return 'All skills';
  return `${agent.skills.length} ${agent.skills.length === 1 ? 'skill' : 'skills'}`;
}

interface EditorProps {
  initial: Draft;
  skills: readonly SkillMetadata[];
  creating: boolean;
  busy: boolean;
  onSave: (draft: Draft) => void;
  onCancel: () => void;
  onDelete: () => void;
}

function AgentEditor({ initial, skills, creating, busy, onSave, onCancel, onDelete }: EditorProps) {
  const [draft, setDraft] = useState(initial);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSave(draft);
  }

  function toggleSkill(name: string, checked: boolean) {
    const current = new Set(draft.skills ?? []);
    if (checked) current.add(name);
    else current.delete(name);
    setDraft({ ...draft, skills: [...current].sort() });
  }

  return (
    <form className="preset-card preset-editor" onSubmit={submit}>
      <h2>{creating ? 'New agent' : initial.name}</h2>
      <label>
        Name
        <input
          value={draft.name}
          maxLength={80}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          required
        />
      </label>
      <label>
        Description
        <input
          value={draft.description}
          maxLength={500}
          placeholder="What this agent is for"
          onChange={(event) => setDraft({ ...draft, description: event.target.value })}
        />
      </label>
      <label>
        Instructions
        <textarea
          value={draft.instructions}
          rows={10}
          placeholder="Added to the agent's standing instructions, e.g. “You are a continuity editor. Check facts against the bible and never change prose.”"
          onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
        />
      </label>
      <fieldset className="agent-skills">
        <legend>Skills</legend>
        <label className="agent-review-toggle">
          <input
            type="radio"
            name="agent-skills-mode"
            checked={draft.skills === null}
            onChange={() => setDraft({ ...draft, skills: null })}
          />
          <span>Every installed skill</span>
        </label>
        <label className="agent-review-toggle">
          <input
            type="radio"
            name="agent-skills-mode"
            checked={draft.skills !== null}
            onChange={() => setDraft({ ...draft, skills: draft.skills ?? [] })}
          />
          <span>Only the skills chosen below</span>
        </label>
        {draft.skills === null ? null : skills.length === 0 ? (
          <p className="empty-inline">No skills are installed yet.</p>
        ) : (
          <ul className="agent-skill-list" aria-label="Chosen skills">
            {skills.map((skill) => (
              <li key={skill.id}>
                <label className="agent-review-toggle">
                  <input
                    type="checkbox"
                    checked={draft.skills?.includes(skill.name) ?? false}
                    onChange={(event) => toggleSkill(skill.name, event.target.checked)}
                  />
                  <span>
                    <strong>{skill.name}</strong>
                    <small>{skill.description}</small>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
      <div className="preset-actions">
        <button type="submit" className="button-primary" disabled={busy}>
          {busy ? 'Saving…' : creating ? 'Create agent' : 'Save changes'}
        </button>
        {creating ? (
          <button type="button" className="button-secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        ) : (
          <button type="button" className="button-danger" disabled={busy} onClick={onDelete}>
            Delete agent
          </button>
        )}
      </div>
    </form>
  );
}

/**
 * Saved custom agents: instructions and a skill selection a chat can run
 * with instead of the default agent. Agents belong to the workspace, not to
 * one book, so any book's chats can use them.
 */
export function AgentsPage() {
  const api = useApi();
  const [version, setVersion] = useState(0);
  const agents = useLoad((signal) => api.listCustomAgents(signal), `agents:${version}`);
  const skills = useLoad((signal) => api.listSkills(signal), 'skills');
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CustomAgent | null>(null);

  if (agents.status === 'loading') return <LoadingState>Gathering agents…</LoadingState>;
  if (agents.status === 'error') {
    return (
      <ErrorState title="Agents could not load" message={agents.message} onRetry={agents.reload} />
    );
  }

  const list = agents.data;
  const current = selected === 'new' ? null : (list.find((agent) => agent.id === selected) ?? null);
  const installed = skills.status === 'ready' ? skills.data : [];

  async function save(draft: Draft) {
    setBusy(true);
    setError(null);
    const input = {
      name: draft.name.trim(),
      description: draft.description.trim(),
      instructions: draft.instructions,
      skills: draft.skills,
    };
    try {
      const saved =
        current === null
          ? await api.createCustomAgent(input)
          : await api.updateCustomAgent(current.id, input);
      setSelected(saved.id);
      setVersion((value) => value + 1);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (deleting === null) return;
    setBusy(true);
    try {
      await api.deleteCustomAgent(deleting.id);
      setDeleting(null);
      setSelected(null);
      setVersion((value) => value + 1);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="presets-page">
      <p className="coordinate-label">Agent roster · {list.length} saved</p>
      <h1>Agents</h1>
      <p className="page-intro">
        A custom agent adds its own standing instructions to the book agent and can be limited to
        chosen skills: a continuity checker, a line editor, a worldbuilder. Pick one when you start
        a chat in a book's Agent tab.
      </p>
      <div className="preset-toolbar">
        <button type="button" className="button-primary" onClick={() => setSelected('new')}>
          New agent
        </button>
      </div>
      {error === null ? null : (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="preset-studio-grid">
        <section className="preset-library" aria-label="Saved agents">
          <h2>Saved</h2>
          {list.length === 0 ? (
            <p className="empty-inline">No custom agents yet. Chats use the default agent.</p>
          ) : (
            <ul>
              {list.map((agent) => (
                <li key={agent.id}>
                  <button
                    type="button"
                    className={agent.id === selected ? 'active' : undefined}
                    onClick={() => setSelected(agent.id)}
                  >
                    <strong>{agent.name}</strong>
                    <small>
                      {skillsLabel(agent)}
                      {agent.description === '' ? '' : ` · ${agent.description}`}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        {selected === 'new' || current !== null ? (
          <AgentEditor
            key={current?.id ?? 'new'}
            initial={current === null ? NEW_AGENT : draftOf(current)}
            skills={installed}
            creating={current === null}
            busy={busy}
            onSave={(draft) => void save(draft)}
            onCancel={() => setSelected(null)}
            onDelete={() => setDeleting(current)}
          />
        ) : (
          <section className="preset-card">
            <h2>Select an agent</h2>
            <p className="empty-inline">Choose a saved agent to edit it, or create a new one.</p>
          </section>
        )}
      </div>
      {deleting === null ? null : (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          confirmLabel="Delete agent"
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void confirmDelete()}
        >
          <p>Chats that use this agent switch to the default agent. Their history stays.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
