import type { BookPlay } from '@worldbookllm/shared';
import { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { Link, useSearchParams } from 'react-router-dom';
import remarkGfm from 'remark-gfm';

import { useApi } from '../api/useApi.js';
import { ErrorState, LoadingState } from '../components/RequestState.js';
import { useBook } from './book-context.js';
import { fileHref } from './book-sections.js';
import { useLoad } from './useLoad.js';

/**
 * Write → Play: the book as its reader meets it, one chapter at a time with
 * its choices as buttons. The story comes from the Twee build, so it has the
 * same prose, links, and refusals as a real build. The current chapter is in
 * the address (`?at=chapter-03`), so the browser's back button steps back.
 */
export function PlayPage() {
  const api = useApi();
  const { slug, tree } = useBook();
  const story = useLoad(
    (signal) => api.getPlay(slug, signal),
    `${slug}:${tree.files.map((file) => file.hash).join()}`,
  );
  const branchesHref = `/books/${encodeURIComponent(slug)}/write/branches`;

  return (
    <section className="book-panel play-page" aria-labelledby="play-heading">
      <p className="coordinate-label">
        <Link to={branchesHref}>Branches</Link>
      </p>
      <h2 id="play-heading">Play</h2>
      {story.status === 'loading' ? <LoadingState>Assembling the story…</LoadingState> : null}
      {story.status === 'error' ? (
        <>
          <ErrorState
            title="The story cannot be played yet"
            message={story.message}
            onRetry={story.reload}
          />
          <p>
            <Link to={branchesHref}>Fix the choices on the Branches screen</Link>, then come back.
          </p>
        </>
      ) : null}
      {story.status === 'ready' ? <PlayThrough slug={slug} story={story.data} /> : null}
    </section>
  );
}

function PlayThrough({ slug, story }: { slug: string; story: BookPlay }) {
  const { tree } = useBook();
  const [params, setParams] = useSearchParams();
  const heading = useRef<HTMLHeadingElement>(null);
  const at = params.get('at') ?? story.start;
  const passage = story.passages.find((entry) => entry.id === at);
  const chapter = tree.files.find((file) => file.kind === 'chapter' && file.entityId === at);
  const title = chapter?.title ?? at;

  // Moving to another chapter moves focus to its heading, as following a link would.
  const shown = useRef(at);
  useEffect(() => {
    if (shown.current !== at) heading.current?.focus();
    shown.current = at;
  }, [at]);

  const restart = () => setParams({});

  return (
    <>
      {story.warnings.length > 0 ? (
        <details className="reader-notes">
          <summary>Build notes ({story.warnings.length})</summary>
          <ul>
            {story.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {passage === undefined ? (
        <div className="play-passage">
          <p>This story has no chapter {at}.</p>
          <button type="button" className="button-secondary" onClick={restart}>
            Start over
          </button>
        </div>
      ) : (
        <article className="play-passage" aria-labelledby="play-chapter-heading">
          <h3 id="play-chapter-heading" ref={heading} tabIndex={-1}>
            {title}
          </h3>
          <div className="markdown-body reader-text">
            {passage.prose === '' ? (
              <p className="coordinate-label">This chapter has no prose yet.</p>
            ) : (
              <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
                {passage.prose}
              </ReactMarkdown>
            )}
          </div>
          {passage.links.length > 0 ? (
            <ul className="play-choices" aria-label="Choices">
              {passage.links.map((link) => (
                <li key={`${link.to}:${link.text}`}>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => setParams({ at: link.to })}
                  >
                    {link.text}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="play-end">
              <p>The end.</p>
              <button type="button" className="button-primary" onClick={restart}>
                Play again
              </button>
            </div>
          )}
          <p className="coordinate-label">
            {chapter === undefined ? null : (
              <Link to={fileHref(slug, chapter.path)}>Edit this chapter</Link>
            )}
            {at === story.start ? null : (
              <>
                {chapter === undefined ? null : ' · '}
                <button type="button" className="text-button" onClick={restart}>
                  Start over
                </button>
              </>
            )}
          </p>
        </article>
      )}
    </>
  );
}
