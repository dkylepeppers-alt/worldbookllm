import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { ApiClientError } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { ErrorState, LoadingState } from '../components/RequestState.js';
import { useBook } from './book-context.js';
import { useLoad } from './useLoad.js';

interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
}

function textOf(node: MarkdownNode | undefined): string {
  if (node === undefined) return '';
  if (node.type === 'text' || node.type === 'inlineCode') return node.value ?? '';
  return (node.children ?? []).map(textOf).join('');
}

function headingId(text: string): string {
  return `reader-${text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/gu, '')}`;
}

/** The manuscript's top-level headings (chapters and matter pages), outside code fences. */
function contentsOf(markdown: string): string[] {
  const headings: string[] = [];
  let fenced = false;
  for (const line of markdown.split('\n')) {
    if (/^\s{0,3}(```|~~~)/u.test(line)) fenced = !fenced;
    const match = fenced ? null : /^# +(.+?)\s*#*\s*$/u.exec(line);
    if (match?.[1]) headings.push(match[1]);
  }
  return headings;
}

/**
 * Drops HTML comments outside code fences: `story export` marks its output
 * with one, and writers keep notes in them that a reader should not see.
 */
function withoutComments(markdown: string): string {
  return markdown
    .split(/(^\s{0,3}(?:```|~~~)[^\n]*\n[\s\S]*?^\s{0,3}(?:```|~~~)[^\n]*$)/mu)
    .map((part, index) => (index % 2 === 1 ? part : part.replace(/<!--[\s\S]*?-->/gu, '')))
    .join('');
}

const components: Components = {
  h1: ({ node, children }) => (
    <h1 id={headingId(textOf(node as MarkdownNode | undefined))}>{children}</h1>
  ),
};

function jumpTo(heading: string) {
  document.getElementById(headingId(heading))?.scrollIntoView({ block: 'start' });
}

/**
 * The manuscript as a reader sees it: `story export` assembles chapter prose
 * and matter pages, without frontmatter, outlines, or notes.
 */
export function ReaderPage() {
  const api = useApi();
  const { slug, tree } = useBook();
  const manuscript = useLoad(
    async (signal) => {
      try {
        return await api.getManuscript(slug, signal);
      } catch (error) {
        // No chapters, or a story.md the CLI cannot use: nothing to read yet, not a failure.
        if (error instanceof ApiClientError && error.code === 'story_unusable_project') {
          return { empty: error.message };
        }
        throw error;
      }
    },
    `${slug}:${tree.files.map((file) => file.hash).join()}`,
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

  if ('empty' in manuscript.data) {
    return (
      <section className="book-panel reader" aria-labelledby="reader-heading">
        <h2 id="reader-heading">Reader</h2>
        <p className="empty-map">
          Nothing to read yet. Chapter prose appears here once it is written. (
          {manuscript.data.empty})
        </p>
      </section>
    );
  }

  const markdown = withoutComments(manuscript.data.markdown);
  const { warnings } = manuscript.data;
  const contents = contentsOf(markdown);
  return (
    <section className="book-panel reader" aria-labelledby="reader-heading">
      <p className="coordinate-label">story export</p>
      <h2 id="reader-heading" className="visually-hidden">
        Reader
      </h2>
      {contents.length > 1 ? (
        <details className="reader-contents">
          <summary>Contents</summary>
          <ol>
            {contents.map((heading, index) => (
              <li key={`${index}:${heading}`}>
                <button type="button" className="text-button" onClick={() => jumpTo(heading)}>
                  {heading}
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
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {markdown}
        </ReactMarkdown>
      </article>
    </section>
  );
}
