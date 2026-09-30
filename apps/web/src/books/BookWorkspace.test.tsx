import type {
  BookFile,
  BookFileDetail,
  BookSummary,
  BookTree,
  Checkpoint,
  StoryCommandOutcome,
} from '@worldbookllm/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AppRoutes } from '../App.js';
import { ApiProvider } from '../api/ApiContext.js';
import { ApiClient, ApiClientError } from '../api/client.js';
import { createTestClient } from '../test/createTestClient.js';

const HASH = 'a'.repeat(64);
const NEW_HASH = 'b'.repeat(64);

const book: BookSummary = {
  slug: 'the-salt-road',
  title: 'The Salt Road',
  genre: 'fantasy',
  status: 'planning',
  kind: 'book',
  seriesId: null,
  bookNumber: null,
  counts: { chapter: 1, character: 1 },
  updatedAt: '2026-09-30T00:00:00.000Z',
};

function file(
  path: string,
  kind: BookFile['kind'],
  entityId: string | null,
  title: string,
): BookFile {
  return { path, kind, entityId, title, hash: HASH, size: 10, updatedAt: book.updatedAt };
}

const tree: BookTree = {
  book,
  files: [
    file('story.md', 'story', null, 'The Salt Road'),
    file('chapters/chapter-01.md', 'chapter', 'chapter-01', 'Arrival'),
    file('scenes/chapter-01-scene-01.md', 'scene', 'chapter-01-scene-01', 'The ferry'),
    file('characters/mara-quill.md', 'character', 'mara-quill', 'Mara Quill'),
    file('characters/_index.md', 'registry', null, 'characters/_index.md'),
    file('worldbuilding/locations/port-kestrel.md', 'location', 'port-kestrel', 'Port Kestrel'),
    file('continuity/state.md', 'state', null, 'continuity/state.md'),
  ],
};

const maraDetail: BookFileDetail = {
  ...file('characters/mara-quill.md', 'character', 'mara-quill', 'Mara Quill'),
  content:
    '---\nname: Mara Quill\nrole: protagonist\naliases: []\n---\n\n# Mara Quill\n\nSalt-grey eyes.\n',
  frontmatter: { name: 'Mara Quill', role: 'protagonist', aliases: [] },
};

function outcome(output: string): StoryCommandOutcome {
  return { output, checkpointId: null, validation: null };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

function renderAt(path: string, overrides: Partial<ApiClient> = {}) {
  const client = createTestClient({
    listBooks: () => Promise.resolve([book]),
    getBookTree: () => Promise.resolve(tree),
    ...overrides,
  });
  render(
    <ApiProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
        <LocationProbe />
      </MemoryRouter>
    </ApiProvider>,
  );
  return client;
}

describe('book library', () => {
  it('lists books and creates a new one', async () => {
    const createBook = vi.fn(() => Promise.resolve({ ...book, slug: 'embers', title: 'Embers' }));
    renderAt('/books', { createBook });

    const list = await screen.findByRole('list', { name: 'Books' });
    expect(within(list).getByRole('link', { name: 'The Salt Road' })).toBeDefined();
    expect(within(list).getByText('1 chapter · 1 in cast')).toBeDefined();

    await userEvent.type(
      screen.getByRole('textbox', { name: 'New book or series title' }),
      'Embers',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Create book' }));
    expect(createBook).toHaveBeenCalledWith({ title: 'Embers' });
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/books/embers/write'),
    );
  });

  it('gathers a series behind its bible, books in reading order, and creates a series', async () => {
    const inSeries = (slug: string, title: string, bookNumber: number): BookSummary => ({
      ...book,
      slug,
      title,
      seriesId: 'tides',
      bookNumber,
    });
    const createSeries = vi.fn(() =>
      Promise.resolve({ ...book, slug: 'ember', title: 'Ember', kind: 'series-bible' as const }),
    );
    renderAt('/books', {
      listBooks: () =>
        Promise.resolve([
          book,
          inSeries('high-water', 'High Water', 2),
          { ...book, slug: 'tides', title: 'Tides', kind: 'series-bible', seriesId: 'tides' },
          inSeries('low-water', 'Low Water', 1),
        ]),
      createSeries,
    });

    const series = await screen.findByRole('region', { name: 'Tides' });
    expect(within(series).getByRole('link', { name: 'Series bible' }).getAttribute('href')).toBe(
      '/books/tides',
    );
    const books = within(series).getByRole('list', { name: 'Books in Tides' });
    expect(
      within(books)
        .getAllByRole('heading')
        .map((heading) => heading.textContent),
    ).toEqual(['Low Water', 'High Water']);
    expect(
      within(screen.getByRole('list', { name: 'Books' })).getAllByRole('heading'),
    ).toHaveLength(1);

    await userEvent.type(
      screen.getByRole('textbox', { name: 'New book or series title' }),
      'Ember',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Create series' }));
    expect(createSeries).toHaveBeenCalledWith({ title: 'Ember' });
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/books/ember/write'),
    );
  });

  it('explains an empty title instead of calling the server', async () => {
    const createBook = vi.fn();
    renderAt('/books', { createBook });
    await userEvent.click(await screen.findByRole('button', { name: 'Create book' }));
    expect(screen.getByRole('alert').textContent).toBe('Enter a title for the book.');
    expect(createBook).not.toHaveBeenCalled();
  });
});

describe('book workspace', () => {
  it('opens on the manuscript with chapters and scene counts', async () => {
    renderAt('/books/the-salt-road');
    expect(await screen.findByRole('heading', { name: 'Chapters' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Arrival' })).toBeDefined();
    expect(screen.getByText('chapter-01 · 1 scene')).toBeDefined();
    const tabs = screen.getByRole('navigation', { name: 'Book' });
    expect(within(tabs).getByRole('link', { name: 'Write' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('groups the bible by section and adds an entity with story add', async () => {
    const addBookEntity = vi.fn(() =>
      Promise.resolve(
        outcome('Created location bellwether-reef: ./worldbuilding/locations/bellwether-reef.md'),
      ),
    );
    renderAt('/books/the-salt-road/bible', {
      addBookEntity,
      readBookFile: () => new Promise(() => undefined),
    });

    const cast = await screen.findByRole('list', { name: 'Cast' });
    expect(within(cast).getByRole('link', { name: 'Mara Quill' })).toBeDefined();
    expect(screen.queryByText('characters/_index.md')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'World' }));
    expect(screen.getByTestId('location').textContent).toBe(
      '/books/the-salt-road/bible?section=world',
    );
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Kind' }), 'location');
    await userEvent.type(screen.getByRole('textbox', { name: 'New location' }), 'Bellwether Reef');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(addBookEntity).toHaveBeenCalledWith('the-salt-road', {
      kind: 'location',
      name: 'Bellwether Reef',
      options: {},
    });
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/books/the-salt-road/files/worldbuilding/locations/bellwether-reef.md',
      ),
    );
  });
});

describe('book files', () => {
  it('shows fields and prose, and saves an edit with the expected hash', async () => {
    const readBookFile = vi.fn(() => Promise.resolve(maraDetail));
    const writeBookFile = vi.fn(() =>
      Promise.resolve({ file: { ...maraDetail, hash: NEW_HASH }, checkpoint: null }),
    );
    renderAt('/books/the-salt-road/files/characters/mara-quill.md', {
      readBookFile,
      writeBookFile,
    });

    expect(await screen.findByRole('heading', { name: 'Mara Quill', level: 2 })).toBeDefined();
    expect(readBookFile).toHaveBeenCalledWith(
      'the-salt-road',
      'characters/mara-quill.md',
      expect.anything(),
    );
    expect(screen.getByText('protagonist')).toBeDefined();
    expect(screen.getByText('Salt-grey eyes.')).toBeDefined();

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const editor = screen.getByRole('textbox', { name: 'Markdown, including frontmatter' });
    await userEvent.type(editor, 'Tall.');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(writeBookFile).toHaveBeenCalledWith('the-salt-road', 'characters/mara-quill.md', {
      content: `${maraDetail.content}Tall.`,
      expectedHash: HASH,
    });
  });

  it('offers to reload when the file changed on disk', async () => {
    const readBookFile = vi.fn(() => Promise.resolve(maraDetail));
    const writeBookFile = vi.fn(() =>
      Promise.reject(
        new ApiClientError(
          409,
          'file_changed',
          'characters/mara-quill.md changed since it was loaded.',
        ),
      ),
    );
    renderAt('/books/the-salt-road/files/characters/mara-quill.md', {
      readBookFile,
      writeBookFile,
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Markdown, including frontmatter' }),
      'x',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('characters/mara-quill.md changed since it was loaded.'),
    ).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'Load the version on disk' }));
    await waitFor(() => expect(readBookFile).toHaveBeenCalledTimes(2));
  });

  it('renames an entity and follows it to its new path', async () => {
    const renameBookEntity = vi.fn(() =>
      Promise.resolve(
        outcome('Renamed character mara-quill to mara-venn: ./characters/mara-venn.md'),
      ),
    );
    renderAt('/books/the-salt-road/files/characters/mara-quill.md', {
      readBookFile: (_slug, path) =>
        path === 'characters/mara-quill.md'
          ? Promise.resolve(maraDetail)
          : new Promise(() => undefined),
      renameBookEntity,
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Rename' }));
    const input = screen.getByRole('textbox', { name: 'New name' });
    await userEvent.clear(input);
    await userEvent.type(input, 'Mara Venn');
    await userEvent.click(screen.getByRole('button', { name: 'Save new name' }));
    expect(renameBookEntity).toHaveBeenCalledWith('the-salt-road', 'character', 'mara-quill', {
      name: 'Mara Venn',
    });
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/books/the-salt-road/files/characters/mara-venn.md',
      ),
    );
  });
});

describe('book health and project', () => {
  it('shows check counts, next actions, and findings linked to files', async () => {
    renderAt('/books/the-salt-road/health', {
      runBookCheck: (_slug, command) =>
        Promise.resolve({
          command,
          exitCode: 0,
          envelope: {
            apiVersion: 'story/v2',
            command,
            ok: true,
            data:
              command === 'report'
                ? {
                    checks: {
                      validate: { ok: true, errors: 0, warnings: 1, dismissed: 0 },
                      links: { ok: false, errors: 2, warnings: 0, dismissed: 0 },
                    },
                  }
                : {
                    actions: [
                      { priority: 'P1', title: 'Fix broken links', detail: 'Run story links.' },
                    ],
                  },
            diagnostics:
              command === 'report'
                ? [
                    {
                      severity: 'error',
                      file: 'characters/mara-quill.md',
                      message: 'references missing location ashen-citadel',
                    },
                  ]
                : [],
          },
        }),
    });

    const checks = await screen.findByRole('list', { name: 'Checks' });
    expect(within(checks).getByText('0 errors · 1 warning')).toBeDefined();
    expect(within(checks).getByText('2 errors · 0 warnings')).toBeDefined();
    expect(screen.getByText('Fix broken links')).toBeDefined();
    const findings = screen.getByRole('list', { name: 'Findings' });
    expect(within(findings).getByRole('link', { name: 'characters/mara-quill.md' })).toBeDefined();
  });

  it('lists history and undoes only the latest live change', async () => {
    const checkpoint = (id: string, label: string, undoneAt: string | null): Checkpoint => ({
      id,
      book: 'the-salt-road',
      label,
      actor: 'user',
      createdAt: book.updatedAt,
      undoneAt,
      files: [{ path: 'characters/mara-quill.md', change: 'modified' }],
    });
    const undoCheckpoint = vi.fn(() =>
      Promise.resolve(checkpoint('11111111-1111-4111-8111-111111111111', 'Edit', book.updatedAt)),
    );
    renderAt('/books/the-salt-road/project', {
      listCheckpoints: () =>
        Promise.resolve([
          checkpoint('22222222-2222-4222-8222-222222222222', 'Undone thing', book.updatedAt),
          checkpoint('11111111-1111-4111-8111-111111111111', 'Edit characters/mara-quill.md', null),
          checkpoint('33333333-3333-4333-8333-333333333333', 'Add character Mara Quill', null),
        ]),
      undoCheckpoint,
    });

    const history = await screen.findByRole('list', { name: 'History' });
    const undoButtons = within(history).getAllByRole('button', { name: 'Undo' });
    expect(undoButtons).toHaveLength(1);
    await userEvent.click(undoButtons[0] as HTMLElement);
    expect(undoCheckpoint).toHaveBeenCalledWith(
      'the-salt-road',
      '11111111-1111-4111-8111-111111111111',
    );
  });

  it('makes a standalone book the first book of a new series', async () => {
    const moveBookToSeries = vi.fn(() =>
      Promise.resolve({ ...book, seriesId: 'the-salt-road-cycle' }),
    );
    renderAt('/books/the-salt-road/project', {
      listCheckpoints: () => Promise.resolve([]),
      moveBookToSeries,
    });
    const title = await screen.findByRole('textbox', { name: 'New series title' });
    expect((title as HTMLInputElement).value).toBe('The Salt Road');
    await userEvent.clear(title);
    await userEvent.type(title, 'The Salt Road Cycle');
    await userEvent.click(screen.getByRole('button', { name: 'Make this a series' }));
    expect(moveBookToSeries).toHaveBeenCalledWith('the-salt-road', {
      newSeriesTitle: 'The Salt Road Cycle',
    });
  });

  it('adds the next book after this one in its series', async () => {
    const inSeries: BookSummary = { ...book, seriesId: 'tides', bookNumber: 1 };
    const addSeriesBook = vi.fn(() =>
      Promise.resolve({ ...book, slug: 'high-water', title: 'High Water', seriesId: 'tides' }),
    );
    renderAt('/books/the-salt-road/project', {
      getBookTree: () => Promise.resolve({ ...tree, book: inSeries }),
      listBooks: () =>
        Promise.resolve([
          inSeries,
          { ...book, slug: 'tides', title: 'Tides', kind: 'series-bible', seriesId: 'tides' },
        ]),
      listCheckpoints: () => Promise.resolve([]),
      addSeriesBook,
    });
    expect(await screen.findByRole('link', { name: 'Tides' })).toBeDefined();
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Add a book to this series' }),
      'High Water',
    );
    expect((screen.getByRole('combobox', { name: 'Comes after' }) as HTMLSelectElement).value).toBe(
      'the-salt-road',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add book' }));
    expect(addSeriesBook).toHaveBeenCalledWith('tides', {
      title: 'High Water',
      follows: 'the-salt-road',
      bookNumber: 2,
    });
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/books/high-water/write'),
    );
  });
});
