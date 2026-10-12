import type { BookFileDetail, BookSummary, BookTree, InteractiveStory } from '@worldbookllm/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AppRoutes } from '../App.js';
import { ApiProvider } from '../api/ApiContext.js';
import { type ApiClient } from '../api/client.js';
import { createTestClient } from '../test/createTestClient.js';

const HASH = 'a'.repeat(64);

const book: BookSummary = {
  slug: 'gull-rock',
  title: 'The Gull Rock Light',
  genre: null,
  status: null,
  kind: 'book',
  seriesId: null,
  bookNumber: null,
  follows: [],
  precedes: [],
  counts: { chapter: 1 },
  updatedAt: '2026-10-09T00:00:00.000Z',
  interactive: true,
};

const content = [
  '---',
  'title: Harbor Wall',
  '---',
  '',
  '## Outline',
  '',
  'The lamp goes dark.',
  '',
  '## Chapter Text',
  '',
  'The lamp is *dark*.',
  '* [Wait] {oops',
  '-> END',
  '',
].join('\n');

const file: BookFileDetail = {
  path: 'chapters/chapter-01.md',
  kind: 'chapter',
  entityId: 'chapter-01',
  title: 'Harbor Wall',
  hash: HASH,
  size: content.length,
  updatedAt: book.updatedAt,
  content,
  frontmatter: { title: 'Harbor Wall' },
};

const tree: BookTree = { book, files: [file] };

function checked(change: Partial<InteractiveStory> = {}): InteractiveStory {
  return {
    title: book.title,
    ifid: null,
    chapters: [],
    compiled: false,
    start: null,
    nodes: [],
    variables: [],
    diagnostics: [
      {
        severity: 'error',
        message: "Expected end of line but saw '{oops'",
        path: 'chapters/chapter-01.md',
        line: 12,
      },
      { severity: 'warning', message: 'Somewhere else', path: 'chapters/chapter-02.md', line: 3 },
    ],
    ...change,
  };
}

function renderFile(overrides: Partial<ApiClient>) {
  const client = createTestClient({
    listBooks: () => Promise.resolve([book]),
    getBookTree: () => Promise.resolve(tree),
    readBookFile: () => Promise.resolve(file),
    ...overrides,
  });
  render(
    <ApiProvider client={client}>
      <MemoryRouter initialEntries={['/books/gull-rock/files/chapters/chapter-01.md']}>
        <AppRoutes />
      </MemoryRouter>
    </ApiProvider>,
  );
}

describe('the ink editor', () => {
  it('reads a chapter as its planning and its ink source', async () => {
    renderFile({});
    const ink = await screen.findByLabelText('Ink');
    expect(ink.tagName).toBe('PRE');
    expect(ink.textContent).toBe('The lamp is *dark*.\n* [Wait] {oops\n-> END');
    expect(screen.getByText('The lamp goes dark.')).toBeTruthy();
  });

  it("edits a chapter as ink, checks the unsaved text, and lists this file's problems", async () => {
    const checkInk = vi.fn(() => Promise.resolve(checked()));
    renderFile({ checkInk });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(await screen.findByText(/everything under it is ink/u)).toBeTruthy();
    expect(screen.getByText('-> chapter_01')).toBeTruthy();
    await waitFor(() =>
      expect(checkInk).toHaveBeenCalledWith(
        'gull-rock',
        { path: 'chapters/chapter-01.md', content },
        expect.anything(),
      ),
    );
    const problems = await screen.findByRole('list', { name: 'Problems in this file' });
    expect(problems.textContent).toContain("Expected end of line but saw '{oops'");
    expect(problems.textContent).not.toContain('Somewhere else');
    expect(within(problems).getByRole('button', { name: 'Line 12' })).toBeTruthy();
    // CodeMirror holds the text, labelled for screen readers.
    const editor = await screen.findByRole('textbox', { name: 'chapters/chapter-01.md, ink' });
    expect(editor.textContent).toContain('The lamp is *dark*.');
  });

  it('offers Play from this chapter when reading it, as saved, not while editing', async () => {
    renderFile({ checkInk: () => Promise.resolve(checked({ compiled: true, diagnostics: [] })) });
    const link = await screen.findByRole('link', { name: 'Play from this chapter' });
    expect(link.getAttribute('href')).toBe('/books/gull-rock/branches/play?from=chapter_01');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(await screen.findByText('This file compiles, and nothing stands out.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Play from this chapter' })).toBeNull();
  });
});
