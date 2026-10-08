import type { BookCheckResult } from '@worldbookllm/shared';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { fileHref } from '../books/book-sections.js';

/** Rows shown before the rest are counted; the full result is under Data. */
const SHOWN_ROWS = 50;

interface GridData {
  chapters: Array<{ id: string; number: number | null; title: string; beat?: string }>;
  rows: Array<{ id: string; name: string | null; known: boolean; cells: boolean[] }>;
}

interface ListData {
  kind: string;
  total: number;
  items: Array<{ id: string; file: string; title: string; fields: Record<string, unknown> }>;
}

interface MentionsData {
  mode: 'entity' | 'audit';
  id: string | null;
  names: string[] | null;
  chapters: Array<{ chapter: string; file: string; count: number; listed: boolean | null }> | null;
  matches: Array<{ file: string; line: number; text: string; excerpt: string }> | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function fieldText(value: unknown): string {
  if (value === null || value === undefined) return '—';
  return Array.isArray(value) ? value.join(', ') : String(value);
}

/** `story grid`: which arcs each chapter advances, as Plottr and Scrivener lay it out. */
function GridView({ data }: { data: GridData }) {
  if (data.rows.length === 0 || data.chapters.length === 0) {
    return <p>No arcs are advanced yet. Set arcs-advanced on chapters to fill the grid.</p>;
  }
  return (
    <div className="story-grid-scroll">
      <table className="story-grid-table">
        <caption className="visually-hidden">Arcs advanced by chapter</caption>
        <thead>
          <tr>
            <th scope="col">Arc</th>
            {data.chapters.map((chapter) => (
              <th key={chapter.id} scope="col">
                {chapter.number ?? chapter.id}
                <span className="visually-hidden">: {chapter.title}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr key={row.id}>
              <th scope="row">
                {row.name ?? row.id}
                {row.known ? null : <span className="coordinate-label"> unknown arc</span>}
              </th>
              {row.cells.map((cell, index) => (
                <td key={data.chapters[index]?.id ?? index}>
                  {cell ? <span aria-label="advanced">●</span> : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <ol className="story-grid-key" aria-label="Chapters">
        {data.chapters.map((chapter) => (
          <li key={chapter.id}>
            <span className="coordinate-label">{chapter.number ?? chapter.id}</span> {chapter.title}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** `story list`: the files of one kind whose frontmatter matched every filter. */
function ListView({ data, slug }: { data: ListData; slug: string }) {
  if (data.items.length === 0) {
    return (
      <p>
        No {data.kind} matched ({data.total} in the book).
      </p>
    );
  }
  return (
    <>
      <p>
        {data.items.length} of {data.total} {data.kind} matched.
      </p>
      <ul className="entry-list" aria-label="Matching files">
        {data.items.slice(0, SHOWN_ROWS).map((item) => (
          <li key={item.file}>
            <Link to={fileHref(slug, item.file)}>{item.title}</Link>
            {Object.keys(item.fields).length > 0 ? (
              <span className="coordinate-label">
                {Object.entries(item.fields)
                  .map(([key, value]) => `${key}: ${fieldText(value)}`)
                  .join(' · ')}
              </span>
            ) : null}
          </li>
        ))}
        {data.items.length > SHOWN_ROWS ? (
          <li>…and {data.items.length - SHOWN_ROWS} more</li>
        ) : null}
      </ul>
    </>
  );
}

/** `story mentions <kind> <id>`: where the prose names one entity, and which chapters list it. */
function MentionsView({ data, slug }: { data: MentionsData; slug: string }) {
  const chapters = data.chapters ?? [];
  const matches = data.matches ?? [];
  return (
    <>
      <p>
        Looked for {(data.names ?? []).join(', ')}: {matches.length}{' '}
        {matches.length === 1 ? 'mention' : 'mentions'} in {chapters.length}{' '}
        {chapters.length === 1 ? 'chapter' : 'chapters'}.
      </p>
      {chapters.length > 0 ? (
        <ul className="entry-list" aria-label="Chapters naming it">
          {chapters.map((chapter) => (
            <li key={chapter.file}>
              <Link to={fileHref(slug, chapter.file)}>{chapter.chapter}</Link>
              <span className="coordinate-label">
                {chapter.count} {chapter.count === 1 ? 'mention' : 'mentions'}
                {chapter.listed === false ? ' · not in its frontmatter' : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {matches.length > 0 ? (
        <details className="story-command-data">
          <summary>Every mention ({matches.length})</summary>
          <ul className="entry-list" aria-label="Mentions">
            {matches.slice(0, SHOWN_ROWS).map((match) => (
              <li key={`${match.file}:${match.line}:${match.excerpt}`}>
                <span className="coordinate-label">
                  {match.file}:{match.line}
                </span>
                <span>{match.excerpt}</span>
              </li>
            ))}
            {matches.length > SHOWN_ROWS ? <li>…and {matches.length - SHOWN_ROWS} more</li> : null}
          </ul>
        </details>
      ) : null}
    </>
  );
}

interface StoryCommandViewProps {
  result: BookCheckResult;
  slug: string;
  /** Shown for commands without a view of their own. */
  fallback: ReactNode;
}

/** A readable view of a result's data, for the commands that have one. */
export function StoryCommandView({ result, slug, fallback }: StoryCommandViewProps) {
  const data = result.envelope.data;
  if (!isObject(data)) return fallback;
  if (result.command === 'grid' && Array.isArray(data.rows) && Array.isArray(data.chapters)) {
    return <GridView data={data as unknown as GridData} />;
  }
  if (result.command === 'list' && Array.isArray(data.items)) {
    return <ListView data={data as unknown as ListData} slug={slug} />;
  }
  if (result.command === 'mentions' && data.mode === 'entity') {
    return <MentionsView data={data as unknown as MentionsData} slug={slug} />;
  }
  return fallback;
}
