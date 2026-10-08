import type { BookCheckCommand, BookCheckQuery, BookCheckResult } from '@worldbookllm/shared';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';

import { useApi } from '../api/useApi.js';
import { useBook } from '../books/book-context.js';
import { fileHref } from '../books/book-sections.js';
import { errorMessage } from '../books/useLoad.js';
import { StoryCommandView } from './StoryCommandViews.js';

const OPEN_KEY = 'worldbookllm.storyCommands.open';
/** Findings listed in the panel and in a message to the agent; the rest are counted. */
const SHOWN_FINDINGS = 25;
/** How much of a command's JSON data goes into a message when it has no findings. */
const DATA_EXCERPT_CHARS = 4000;

const COMMANDS: ReadonlyArray<{
  command: BookCheckCommand;
  label: string;
  seriesOnly?: true;
  /** Asks for its arguments before it runs. */
  takesArgs?: true;
}> = [
  { command: 'check', label: 'Every check, one verdict' },
  { command: 'validate', label: 'Structure and frontmatter' },
  { command: 'links', label: 'Broken references' },
  { command: 'continuity', label: 'Facts and state conflicts' },
  { command: 'next', label: 'What to work on next' },
  { command: 'report', label: 'Every check at once' },
  { command: 'doctor', label: 'Setup problems' },
  { command: 'progress', label: 'Word counts and status' },
  { command: 'timeline', label: 'Story timeline' },
  { command: 'pacing', label: 'Chapter pacing' },
  { command: 'clues', label: 'Clues and payoffs' },
  { command: 'voices', label: 'Character voices' },
  { command: 'prose', label: 'Prose style' },
  { command: 'grid', label: 'Arcs by chapter' },
  { command: 'mentions', label: 'Who the prose names', takesArgs: true },
  { command: 'list', label: 'Find files by field', takesArgs: true },
  { command: 'series', label: 'Series links', seriesOnly: true },
];

/** `story list` kinds, as the CLI names them. */
const LIST_KINDS = [
  'chapters',
  'scenes',
  'characters',
  'locations',
  'factions',
  'artifacts',
  'systems',
  'arcs',
  'questions',
  'promises',
  'clues',
  'terms',
  'research',
  'matter',
] as const;

/** Entity kinds `story mentions` looks for in the prose. */
const MENTION_KINDS = new Set(['character', 'location', 'faction', 'artifact', 'system', 'term']);

/** The command line a result came from, for the panel and the agent. */
function commandLine(command: BookCheckCommand, query: BookCheckQuery): string {
  const parts = [`story ${command}`];
  if (query.kind) parts.push(query.kind);
  if (query.id) parts.push(query.id);
  for (const filter of [query.where ?? []].flat()) parts.push(`--where '${filter}'`);
  return parts.join(' ');
}

interface Action {
  priority: string;
  title: string;
  detail: string;
}

function actionsOf(result: BookCheckResult): Action[] {
  if (result.command !== 'next') return [];
  const data = result.envelope.data as { actions?: Action[] } | null;
  return data?.actions ?? [];
}

function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function summaryOf(result: BookCheckResult): string {
  const errors = result.envelope.diagnostics.filter((entry) => entry.severity === 'error').length;
  const warnings = result.envelope.diagnostics.filter(
    (entry) => entry.severity === 'warning',
  ).length;
  return `${counted(errors, 'error')} · ${counted(warnings, 'warning')}`;
}

/** A message for the agent describing a result, for the writer to edit before sending. */
function messageFor(result: BookCheckResult, query: BookCheckQuery): string {
  const lines = [`I ran \`${commandLine(result.command, query)}\`: ${summaryOf(result)}.`];
  const findings = result.envelope.diagnostics.filter((entry) => entry.severity !== 'dismissed');
  for (const finding of findings.slice(0, SHOWN_FINDINGS)) {
    const where = typeof finding.file === 'string' ? `${finding.file}: ` : '';
    lines.push(`- ${finding.severity}: ${where}${finding.message}`);
  }
  if (findings.length > SHOWN_FINDINGS) {
    lines.push(`- …and ${findings.length - SHOWN_FINDINGS} more`);
  }
  for (const action of actionsOf(result)) {
    lines.push(`- ${action.priority}: ${action.title}. ${action.detail}`);
  }
  if (findings.length === 0 && actionsOf(result).length === 0 && result.envelope.data != null) {
    const data = JSON.stringify(result.envelope.data, null, 2);
    lines.push(
      '```json',
      data.length > DATA_EXCERPT_CHARS ? `${data.slice(0, DATA_EXCERPT_CHARS)}\n…` : data,
      '```',
    );
  }
  lines.push(findings.length > 0 ? 'Please fix these.' : 'What does this tell us about the book?');
  return lines.join('\n');
}

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeOpen(open: boolean): void {
  try {
    localStorage.setItem(OPEN_KEY, String(open));
  } catch {
    // Remembering the panel is a convenience; private windows may refuse it.
  }
}

interface StoryCommandsPanelProps {
  /** Adds text to the agent message draft. */
  onAsk: (text: string) => void;
}

/**
 * Read-only `story` checks run straight from the Agent tab, without spending
 * an agent turn. A result can be handed to the agent as a message draft.
 */
export function StoryCommandsPanel({ onAsk }: StoryCommandsPanelProps) {
  const api = useApi();
  const { slug, tree } = useBook();
  const [open, setOpen] = useState(readOpen);
  const [running, setRunning] = useState<BookCheckCommand | null>(null);
  const [result, setResult] = useState<BookCheckResult | null>(null);
  const [query, setQuery] = useState<BookCheckQuery>({});
  const [error, setError] = useState<string | null>(null);
  /** The command whose arguments are being filled in. */
  const [asking, setAsking] = useState<'list' | 'mentions' | null>(null);
  const [listKind, setListKind] = useState<(typeof LIST_KINDS)[number]>('chapters');
  const [filters, setFilters] = useState('');
  const [entity, setEntity] = useState('');

  const mentionable = tree.files
    .filter((file) => file.entityId !== null && MENTION_KINDS.has(file.kind))
    .sort((left, right) => left.title.localeCompare(right.title));

  async function run(command: BookCheckCommand, args: BookCheckQuery = {}) {
    setRunning(command);
    setError(null);
    try {
      setResult(
        Object.keys(args).length === 0
          ? await api.runBookCheck(slug, command)
          : await api.runBookCheck(slug, command, undefined, args),
      );
      setQuery(args);
    } catch (caught) {
      setResult(null);
      setError(errorMessage(caught));
    } finally {
      setRunning(null);
    }
  }

  function runWithArgs(event: FormEvent) {
    event.preventDefault();
    if (asking === 'list') {
      const where = filters
        .split(';')
        .map((filter) => filter.trim())
        .filter((filter) => filter !== '');
      void run('list', where.length > 0 ? { kind: listKind, where } : { kind: listKind });
    } else if (asking === 'mentions') {
      const file = mentionable.find((candidate) => candidate.path === entity);
      void run('mentions', file?.entityId ? { kind: file.kind, id: file.entityId } : {});
    }
  }

  const commands = COMMANDS.filter((entry) => !entry.seriesOnly || tree.book.seriesId !== null);
  const findings = result?.envelope.diagnostics ?? [];
  const actions = result === null ? [] : actionsOf(result);

  return (
    <details
      className="story-commands"
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        setOpen(next);
        writeOpen(next);
      }}
    >
      <summary>Story commands</summary>
      <p className="story-commands-note">
        Run a check on the book as saved. Nothing is changed, and no agent turn is used.
      </p>
      <ul className="story-command-grid" aria-label="Story commands">
        {commands.map(({ command, label, takesArgs }) => (
          <li key={command}>
            <button
              type="button"
              className="button-secondary"
              disabled={running !== null}
              // The last command run is marked for sight only: these buttons are not toggles.
              data-last-run={result?.command === command ? '' : undefined}
              aria-expanded={takesArgs ? asking === command : undefined}
              onClick={() =>
                takesArgs
                  ? setAsking(asking === command ? null : (command as 'list' | 'mentions'))
                  : void run(command)
              }
            >
              <code>{command}</code>
              <span>{running === command ? 'Running…' : label}</span>
            </button>
          </li>
        ))}
      </ul>

      {asking === null ? null : (
        <form
          className="story-command-args"
          aria-label={`story ${asking} arguments`}
          onSubmit={runWithArgs}
        >
          {asking === 'list' ? (
            <>
              <label>
                Kind
                <select
                  value={listKind}
                  onChange={(event) =>
                    setListKind(event.target.value as (typeof LIST_KINDS)[number])
                  }
                >
                  {LIST_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {kind}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Filters (optional, separated by ;)
                <input
                  value={filters}
                  maxLength={500}
                  placeholder="status=draft; pov=mara-quill"
                  onChange={(event) => setFilters(event.target.value)}
                />
              </label>
            </>
          ) : (
            <label>
              Entity
              <select value={entity} onChange={(event) => setEntity(event.target.value)}>
                <option value="">Every chapter: names missing from frontmatter</option>
                {mentionable.map((file) => (
                  <option key={file.path} value={file.path}>
                    {file.title} ({file.kind})
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="submit" className="button-primary" disabled={running !== null}>
            {running === asking ? 'Running…' : `Run story ${asking}`}
          </button>
        </form>
      )}

      {error === null ? null : (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {result === null ? null : (
        <section className="story-command-result" aria-label={`story ${result.command} result`}>
          <p className="coordinate-label" role="status">
            {commandLine(result.command, query)} ·{' '}
            {result.envelope.ok ? 'ok' : `exit ${result.exitCode}`} · {summaryOf(result)}
          </p>
          {actions.length > 0 ? (
            <ol className="entry-list">
              {actions.map((action) => (
                <li key={`${action.priority}:${action.title}`}>
                  <span className="coordinate-label">{action.priority}</span>
                  <strong>{action.title}</strong>
                  <span>{action.detail}</span>
                </li>
              ))}
            </ol>
          ) : null}
          {findings.length > 0 ? (
            <ul className="entry-list" aria-label="Command findings">
              {findings.slice(0, SHOWN_FINDINGS).map((finding, index) => (
                <li key={`${index}:${finding.message}`}>
                  <span className="coordinate-label">{finding.severity}</span>
                  <span>{finding.message}</span>
                  {typeof finding.file === 'string' ? (
                    <Link to={fileHref(slug, finding.file)}>{finding.file}</Link>
                  ) : null}
                </li>
              ))}
              {findings.length > SHOWN_FINDINGS ? (
                <li>…and {findings.length - SHOWN_FINDINGS} more</li>
              ) : null}
            </ul>
          ) : null}
          <StoryCommandView
            result={result}
            slug={slug}
            fallback={findings.length === 0 && actions.length === 0 ? <p>No findings.</p> : null}
          />
          {result.envelope.data != null && actions.length === 0 ? (
            <details className="story-command-data">
              <summary>Data</summary>
              <pre>{JSON.stringify(result.envelope.data, null, 2)}</pre>
            </details>
          ) : null}
          <div className="story-command-actions">
            <button
              type="button"
              className="button-primary"
              onClick={() => onAsk(messageFor(result, query))}
            >
              Ask the agent about this
            </button>
            <button type="button" className="text-button" onClick={() => setResult(null)}>
              Clear
            </button>
          </div>
        </section>
      )}
    </details>
  );
}
