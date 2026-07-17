import {
  SOURCE_CATEGORIES,
  type SourceCategory,
  type SourceMetadata,
  type SourceSearchResult,
} from '@worldbookllm/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';

import { useApi } from '../api/useApi.js';
import { ErrorState, LoadingState } from '../components/RequestState.js';
import { useDebouncedValue } from '../hooks/useDebouncedValue.js';
import { useNotebookWorkspace } from '../notebooks/notebook-workspace-context.js';
import { SourcePasteDialog } from './SourcePasteDialog.js';
import { SourceImportDialog } from './SourceImportDialog.js';

const IMPORT_ACCEPT =
  '.md,.markdown,.txt,.json,.pdf,.html,.htm,text/markdown,text/plain,application/json,application/pdf,text/html';

type SourceSort = 'created' | 'updated' | 'title';

type SearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; results: SourceSearchResult[] };

/** A finished search request: `results` is null when the request failed. */
interface CompletedSearch {
  query: string;
  results: SourceSearchResult[] | null;
}

function formatUpdated(value: string): string {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value));
}

function matchesFilters(
  source: SourceMetadata,
  category: 'all' | SourceCategory,
  tag: string,
): boolean {
  if (category !== 'all' && source.category !== category) return false;
  if (tag !== 'all' && !source.tags.includes(tag)) return false;
  return true;
}

function sortSources(sources: SourceMetadata[], sort: SourceSort): SourceMetadata[] {
  const sorted = [...sources];
  if (sort === 'updated') {
    sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  } else if (sort === 'title') {
    sorted.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  }
  // 'created' keeps the server order (created ASC), the pre-M3 default.
  return sorted;
}

function SourceRowMeta({ source }: { source: SourceMetadata }) {
  if (source.category === null && source.tags.length === 0) return null;
  const parts = [
    ...(source.category === null ? [] : [source.category]),
    ...source.tags.map((tag) => `#${tag}`),
  ];
  return <span className="source-meta coordinate-label">{parts.join(' · ')}</span>;
}

export function SourceList() {
  const api = useApi();
  const { notebookId, sourcesState, retrySources } = useNotebookWorkspace();
  const [pasteOpen, setPasteOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'all' | SourceCategory>('all');
  const [tag, setTag] = useState('all');
  const [sort, setSort] = useState<SourceSort>('created');
  // The last completed search, tagged with the query that produced it; the
  // display status is derived from how it relates to the current query.
  const [completed, setCompleted] = useState<CompletedSearch | null>(null);
  const debouncedQuery = useDebouncedValue(query.trim(), 250);

  useEffect(() => {
    if (debouncedQuery === '') return;
    const controller = new AbortController();
    api
      .searchSources(notebookId, debouncedQuery, controller.signal)
      .then((results) => setCompleted({ query: debouncedQuery, results }))
      .catch(() => {
        if (!controller.signal.aborted) setCompleted({ query: debouncedQuery, results: null });
      });
    return () => controller.abort();
  }, [api, notebookId, debouncedQuery]);

  const availableTags = useMemo(
    () =>
      sourcesState.status === 'ready'
        ? [...new Set(sourcesState.sources.flatMap((source) => source.tags))].sort()
        : [],
    [sourcesState],
  );

  const sources = sourcesState.status === 'ready' ? sourcesState.sources : [];
  const searching = query.trim() !== '';
  // Only a completed search for the query currently in the box counts —
  // anything else is still loading, so stale results never show.
  const searchState: SearchState = !searching
    ? { status: 'idle' }
    : completed === null || completed.query !== query.trim()
      ? { status: 'loading' }
      : completed.results === null
        ? { status: 'error' }
        : { status: 'ready', results: completed.results };

  const excerpts = new Map<string, string>();
  let visible: SourceMetadata[];
  if (searching) {
    const results = searchState.status === 'ready' ? searchState.results : [];
    for (const result of results) excerpts.set(result.id, result.excerpt);
    // Results keep the server's relevance order; filters intersect client-side.
    visible = results.filter((result) => matchesFilters(result, category, tag));
  } else {
    visible = sortSources(
      sources.filter((source) => matchesFilters(source, category, tag)),
      sort,
    );
  }

  return (
    <div className="source-index">
      <header className="region-header">
        <div>
          <p className="coordinate-label">Source bearings</p>
          <h2>Sources</h2>
        </div>
        <div className="source-actions">
          <input
            ref={fileInputRef}
            type="file"
            aria-label="Source file"
            accept={IMPORT_ACCEPT}
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) setImportFile(file);
              event.target.value = '';
            }}
          />
          <button
            type="button"
            className="button-secondary"
            onClick={() => fileInputRef.current?.click()}
          >
            Import file
          </button>
          <button type="button" className="button-primary" onClick={() => setPasteOpen(true)}>
            Paste source
          </button>
        </div>
      </header>

      {sourcesState.status === 'loading' ? (
        <LoadingState>Plotting sources…</LoadingState>
      ) : sourcesState.status === 'error' ? (
        <ErrorState
          title="Could not load sources"
          message="The notebook is open, but its source index could not be read."
          onRetry={retrySources}
        />
      ) : sourcesState.sources.length === 0 ? (
        <div className="empty-map">
          <p className="coordinate-label">No sources plotted</p>
          <p>Paste or import your first source to establish a reference point.</p>
        </div>
      ) : (
        <>
          <div className="source-browser-controls">
            <div className="source-search-field">
              <label htmlFor="source-search">Search</label>
              <input
                id="source-search"
                type="search"
                placeholder="Find across all sources"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="source-category-filter">Category</label>
              <select
                id="source-category-filter"
                value={category}
                onChange={(event) => setCategory(event.target.value as 'all' | SourceCategory)}
              >
                <option value="all">All</option>
                {SOURCE_CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
            {availableTags.length === 0 ? null : (
              <div>
                <label htmlFor="source-tag-filter">Tag</label>
                <select
                  id="source-tag-filter"
                  value={tag}
                  onChange={(event) => setTag(event.target.value)}
                >
                  <option value="all">All</option>
                  {availableTags.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label htmlFor="source-sort">Sort</label>
              <select
                id="source-sort"
                value={sort}
                disabled={searching}
                onChange={(event) => setSort(event.target.value as SourceSort)}
              >
                <option value="created">First plotted</option>
                <option value="updated">Recently updated</option>
                <option value="title">Title A–Z</option>
              </select>
            </div>
          </div>

          {searching && searchState.status === 'loading' ? (
            <LoadingState>Searching the territory…</LoadingState>
          ) : searching && searchState.status === 'error' ? (
            <ErrorState
              title="Search failed"
              message="The notebook could not be searched. Adjust the query and try again."
            />
          ) : visible.length === 0 ? (
            <div className="empty-map">
              <p className="coordinate-label">No sources match this bearing</p>
              <p>Adjust the search or filters to widen the survey.</p>
            </div>
          ) : (
            <ol className="source-list">
              {visible.map((source, index) => {
                const excerpt = excerpts.get(source.id);
                return (
                  <li key={source.id}>
                    <NavLink
                      aria-label={source.title}
                      to={`/notebooks/${notebookId}/sources/${source.id}`}
                    >
                      <span className="source-spine" aria-hidden="true" />
                      <span className="source-order">{String(index + 1).padStart(2, '0')}</span>
                      <span className="source-title">{source.title}</span>
                      <SourceRowMeta source={source} />
                      {excerpt === undefined ? null : (
                        <span className="source-excerpt">{excerpt}</span>
                      )}
                      <span className="source-words">
                        {source.wordCount.toLocaleString()} words
                      </span>
                      <span className="source-updated">
                        Updated {formatUpdated(source.updatedAt)}
                      </span>
                    </NavLink>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}

      {pasteOpen ? <SourcePasteDialog onClose={() => setPasteOpen(false)} /> : null}
      {importFile !== null ? (
        <SourceImportDialog file={importFile} onClose={() => setImportFile(null)} />
      ) : null}
    </div>
  );
}
