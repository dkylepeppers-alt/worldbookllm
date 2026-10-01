import { useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

import { useApi } from '../api/useApi.js';
import { ErrorState, LoadingState } from '../components/RequestState.js';
import { useBook } from './book-context.js';
import { useLoad } from './useLoad.js';

interface MarkdownNode {
  type: string;
  value?: string;
  depth?: number;
  children?: MarkdownNode[];
  position?: { start: { offset?: number } };
}

interface ContentsEntry {
  id: string;
  title: string;
}

function textOf(node: MarkdownNode): string {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value ?? '';
  return (node.children ?? []).map(textOf).join('');
}

function slugOf(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-|-$/gu, '') || 'section'
  );
}

/**
 * The manuscript's top-level headings (chapters and matter pages), from the
 * same parse ReactMarkdown renders, so code blocks never yield entries.
 * Keyed by each heading's source offset, which the rendered heading carries
 * too; repeated titles get a numbered id.
 */
function contentsOf(markdown: string): Map<number, ContentsEntry> {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as MarkdownNode;
  const contents = new Map<number, ContentsEntry>();
  const used = new Map<string, number>();
  for (const node of tree.children ?? []) {
    const offset = node.position?.start.offset;
    if (node.type !== 'heading' || node.depth !== 1 || offset === undefined) continue;
    const title = textOf(node);
    const slug = slugOf(title);
    const seen = used.get(slug) ?? 0;
    used.set(slug, seen + 1);
    contents.set(offset, { id: `reader-${slug}${seen === 0 ? '' : `-${seen + 1}`}`, title });
  }
  return contents;
}

/** Scrolls to a heading and moves focus there, as following a link would. */
function jumpTo(id: string) {
  const heading = document.getElementById(id);
  heading?.scrollIntoView({ block: 'start' });
  heading?.focus({ preventScroll: true });
}

/**
 * The manuscript as a reader sees it: `story export` assembles chapter prose
 * and matter pages, without frontmatter, outlines, or notes.
 */
export function ReaderPage() {
  const api = useApi();
  const { slug, tree } = useBook();
  const manuscript = useLoad(
    (signal) => api.getManuscript(slug, signal),
    `${slug}:${tree.files.map((file) => file.hash).join()}`,
  );
  const markdown = manuscript.status === 'ready' ? manuscript.data.markdown : '';
  const contents = useMemo(() => contentsOf(markdown), [markdown]);
  const components = useMemo<Components>(
    () => ({
      h1: ({ node, children }) => {
        const offset = (node as MarkdownNode | undefined)?.position?.start.offset;
        const entry = offset === undefined ? undefined : contents.get(offset);
        return (
          <h1 id={entry?.id} tabIndex={entry === undefined ? undefined : -1}>
            {children}
          </h1>
        );
      },
    }),
    [contents],
  );

  if (manuscript.status === 'loading')
    return <LoadingState>Assembling the manuscript…</LoadingState>;
  if (manuscript.status === 'error') {
    return (
      <ErrorState
        title="The manuscript could not be assembled"
        message={manuscript.message}
        onRetry={manuscript.reload}
      />
    );
  }

  if (markdown.trim() === '') {
    return (
      <section className="book-panel reader" aria-labelledby="reader-heading">
        <h2 id="reader-heading">Reader</h2>
        <p className="empty-map">
          Nothing to read yet. Chapter prose appears here once the book has chapters.
        </p>
      </section>
    );
  }

  const { warnings } = manuscript.data;
  return (
    <section className="book-panel reader" aria-labelledby="reader-heading">
      <p className="coordinate-label">story export</p>
      <h2 id="reader-heading" className="visually-hidden">
        Reader
      </h2>
      {contents.size > 1 ? (
        <details className="reader-contents">
          <summary>Contents</summary>
          <ol>
            {[...contents.values()].map((entry) => (
              <li key={entry.id}>
                <button type="button" className="text-button" onClick={() => jumpTo(entry.id)}>
                  {entry.title}
                </button>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      {warnings.length > 0 ? (
        <details className="reader-notes">
          <summary>
            {warnings.length} {warnings.length === 1 ? 'note' : 'notes'} from story export
          </summary>
          <ul>
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <article className="markdown-body reader-text">
        {/* Raw HTML is skipped: export's marker comment and writers' hidden notes are not prose. */}
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
          {markdown}
        </ReactMarkdown>
      </article>
    </section>
  );
}
