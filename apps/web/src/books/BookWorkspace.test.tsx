import type {
  BookFile,
  BookFileDetail,
  BookSummary,
  BookTree,
  Checkpoint,
  StoryCommandOutcome,
} from '@worldbookllm/shared';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
  follows: [],
  precedes: [],
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

describe('remaining series structure', () => {
  it('reports conflicting copied folders in the library without opening them', async () => {
    renderAt('/books', {
      listBookConflicts: async () => [
        { slug: 'harbor', path: 'series/tides/harbor', seriesId: 'tides', kind: 'book' },
      ],
    });
    expect(await screen.findByText('series/tides/harbor')).toBeTruthy();
    expect(screen.getByText(/Duplicate book folders/i)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'series/tides/harbor' })).toBeNull();
  });

  it('confirms removing a series book and reloads its standalone project', async () => {
    const user = userEvent.setup();
    let removed = false;
    renderAt(`/books/${book.slug}/project`, {
      getBookTree: async () => ({ ...tree, book: { ...book, seriesId: removed ? null : 'tides' } }),
      removeSeriesBook: async (id, slug) => {
        expect([id, slug]).toEqual(['tides', 'the-salt-road']);
        removed = true;
        return book;
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Remove book from series' }));
    await user.click(screen.getByRole('button', { name: 'Move to standalone books' }));
    expect(await screen.findByText(/This book stands alone/)).toBeTruthy();
  });
});

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

  it('keeps unsaved edits after leaving the file, and discards them on request', async () => {
    const readBookFile = vi.fn(() => Promise.resolve(maraDetail));
    const writeBookFile = vi.fn(() =>
      Promise.resolve({ file: { ...maraDetail, hash: NEW_HASH }, checkpoint: null }),
    );
    const path = '/books/the-salt-road/files/characters/mara-quill.md';
    renderAt(path, { readBookFile, writeBookFile });
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Markdown, including frontmatter' }),
      'Tall.',
    );
    cleanup();

    renderAt(path, { readBookFile, writeBookFile });
    const editor = await screen.findByRole<HTMLTextAreaElement>('textbox', {
      name: 'Markdown, including frontmatter',
    });
    expect(editor.value).toBe(`${maraDetail.content}Tall.`);
    expect(screen.getByText('Your unsaved edits were restored.')).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'Discard edits' }));
    cleanup();

    renderAt(path, { readBookFile, writeBookFile });
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(
      screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Markdown, including frontmatter' })
        .value,
    ).toBe(maraDetail.content);
  });

  it('holds a rename until unsaved edits are saved or discarded', async () => {
    renderAt('/books/the-salt-road/files/characters/mara-quill.md', {
      readBookFile: () => Promise.resolve(maraDetail),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Markdown, including frontmatter' }),
      'Tall.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    expect(screen.getByText(/Save or discard your unsaved edits/u)).toBeDefined();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save new name' }).disabled).toBe(
      true,
    );
  });

  it('says when restored edits predate a change on disk', async () => {
    const path = '/books/the-salt-road/files/characters/mara-quill.md';
    renderAt(path, { readBookFile: () => Promise.resolve(maraDetail) });
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Markdown, including frontmatter' }),
      'Tall.',
    );
    cleanup();

    renderAt(path, { readBookFile: () => Promise.resolve({ ...maraDetail, hash: NEW_HASH }) });
    expect(
      await screen.findByText(/This file changed after you started editing it/u),
    ).toBeDefined();
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

  it('adds a linked book after the highest existing book number', async () => {
    const inSeries: BookSummary = { ...book, seriesId: 'tides', bookNumber: 1 };
    const existingSequel: BookSummary = {
      ...book,
      slug: 'high-water',
      title: 'High Water',
      seriesId: 'tides',
      bookNumber: 2,
    };
    const addSeriesBook = vi.fn(() =>
      Promise.resolve({ ...book, slug: 'spring-tide', title: 'Spring Tide', seriesId: 'tides' }),
    );
    renderAt('/books/the-salt-road/project', {
      getBookTree: () => Promise.resolve({ ...tree, book: inSeries }),
      listBooks: () =>
        Promise.resolve([
          inSeries,
          existingSequel,
          { ...book, slug: 'tides', title: 'Tides', kind: 'series-bible', seriesId: 'tides' },
        ]),
      listCheckpoints: () => Promise.resolve([]),
      addSeriesBook,
    });
    expect(await screen.findByRole('link', { name: 'Tides' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Move book to trash' })).toBeNull();
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Add a book to this series' }),
      'Spring Tide',
    );
    expect((screen.getByRole('combobox', { name: 'Comes after' }) as HTMLSelectElement).value).toBe(
      'the-salt-road',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add book' }));
    expect(addSeriesBook).toHaveBeenCalledWith('tides', {
      title: 'Spring Tide',
      follows: 'the-salt-road',
      bookNumber: 3,
    });
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/books/spring-tide/write'),
    );
  });
});

describe('builds and project import', () => {
  it('builds an EPUB from the Project tab and lists it for download', async () => {
    const epub = { name: 'the-salt-road.epub', size: 2048, updatedAt: book.updatedAt };
    let built = false;
    const createBuild = vi.fn(() => {
      built = true;
      return Promise.resolve({
        file: epub,
        output: 'Built 1 chapters as epub to ./dist/the-salt-road.epub',
      });
    });
    renderAt('/books/the-salt-road/project', {
      listBuilds: () => Promise.resolve(built ? [epub] : []),
      createBuild,
    });

    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Build' });
    expect(screen.queryByLabelText('Trim size')).toBeNull();
    await user.selectOptions(screen.getByLabelText('Format'), 'print');
    screen.getByLabelText('Trim size');
    await user.selectOptions(screen.getByLabelText('Format'), 'epub');
    await user.click(screen.getByRole('button', { name: 'Build' }));

    expect(createBuild).toHaveBeenCalledWith('the-salt-road', { format: 'epub' });
    expect((await screen.findByRole('status', { name: 'Build output' })).textContent).toContain(
      'as epub to ./dist',
    );
    const link = await screen.findByRole('link', { name: 'the-salt-road.epub' });
    expect(link.getAttribute('href')).toBe('/api/books/the-salt-road/builds/the-salt-road.epub');
    expect(link.getAttribute('download')).toBe('the-salt-road.epub');
  });

  it('adds reviewed files to the book from the Project tab', async () => {
    const zipOrigin = { type: 'file' as const, fileName: 'more.zip', mediaType: 'application/zip' };
    const previewBookImport = vi.fn(() =>
      Promise.resolve({
        format: 'markdown' as const,
        origin: zipOrigin,
        conversionNotes: ['Skipped more.zip/cover.png (not a Markdown or text file).'],
        entries: [
          {
            title: 'Chapter 2: The Mill',
            markdown: 'Flour dust.\n',
            suggestedKind: 'chapter' as const,
            entityFile: false,
            origin: { ...zipOrigin, fileName: 'more.zip: ch-2.md', mediaType: 'text/markdown' },
          },
          {
            title: 'Mill notes',
            markdown: 'Grinding stones.\n',
            suggestedKind: 'research' as const,
            entityFile: false,
            origin: {
              ...zipOrigin,
              fileName: 'more.zip: notes/mill.md',
              mediaType: 'text/markdown',
            },
          },
        ],
      }),
    );
    const importBookEntries = vi.fn(() =>
      Promise.resolve({
        files: ['chapters/chapter-02.md'],
        checkpointId: '00000000-0000-4000-8000-000000000001',
        validation: null,
      }),
    );
    renderAt('/books/the-salt-road/project', { previewBookImport, importBookEntries });
    const user = userEvent.setup();
    await user.upload(
      await screen.findByLabelText(/Choose files/u),
      new File([new Uint8Array([0x50, 0x4b])], 'more.zip', { type: 'application/zip' }),
    );

    const list = await screen.findByRole('list', { name: 'Files to add' });
    expect(
      within(list)
        .getAllByLabelText('As')
        .map((select) => (select as HTMLSelectElement).value),
    ).toEqual(['chapter', 'research']);
    expect(screen.getByRole('list', { name: 'Conversion notes' }).textContent).toContain(
      'cover.png',
    );
    await user.click(within(list).getAllByLabelText('Add')[1]!);
    await user.click(screen.getByRole('button', { name: 'Add 1 entry to the book' }));

    expect(importBookEntries).toHaveBeenCalledWith('the-salt-road', {
      origin: { ...zipOrigin, fileName: 'more.zip: ch-2.md', mediaType: 'text/markdown' },
      conversionNotes: [],
      entries: [
        {
          title: 'Chapter 2: The Mill',
          markdown: 'Flour dust.\n',
          kind: 'chapter',
          origin: { ...zipOrigin, fileName: 'more.zip: ch-2.md', mediaType: 'text/markdown' },
        },
      ],
    });
    expect((await screen.findByRole('status', { name: 'Added files' })).textContent).toContain(
      'chapters/chapter-02.md',
    );
    expect(screen.queryByRole('list', { name: 'Files to add' })).toBeNull();
  });

  it('opens an imported project with its import report', async () => {
    const importManuscript = vi.fn(() =>
      Promise.resolve({
        book,
        output:
          'Imported 7 files from salt.zip.\nSkipped 1:\n- notes.docx (not a project file type)',
      }),
    );
    renderAt('/books', { importManuscript });
    const user = userEvent.setup();
    const input = await screen.findByLabelText(/Import a manuscript, a project/u);
    await user.upload(
      input,
      new File([new Uint8Array([0x50, 0x4b])], 'salt.zip', { type: 'application/zip' }),
    );

    expect(importManuscript).toHaveBeenCalled();
    const report = await screen.findByRole('status', { name: 'Import report' });
    expect(report.textContent).toContain('notes.docx (not a project file type)');
    expect(screen.getByTestId('location').textContent).toBe('/books/the-salt-road/write');
    await user.click(within(report).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status', { name: 'Import report' })).toBeNull();
  });
});

describe('reader', () => {
  const manuscript = {
    markdown: [
      '# The Salt Road',
      '',
      '<!-- Generated by story export. -->',
      '',
      '# Chapter 1: *Arrival*',
      '',
      'Mara stepped off the ferry.',
      '<!-- fix the tide times -->',
      '',
      '~~~',
      '```',
      '# Not a heading',
      '<!-- kept in code -->',
      '~~~',
      '',
      '# Interlude',
      '',
      'Gulls.',
      '',
      '# Interlude',
      '',
      'The bell rang twice.',
      '',
    ].join('\n'),
    warnings: [
      'warning: chapters/chapter-03.md has no prose yet and is built as a heading-only page',
    ],
  };

  it('shows the assembled manuscript with contents that jump to each chapter', async () => {
    const getManuscript = vi.fn(() => Promise.resolve(manuscript));
    renderAt('/books/the-salt-road/read', { getManuscript });

    const article = await screen.findByRole('article');
    expect(getManuscript).toHaveBeenCalledWith('the-salt-road', expect.any(AbortSignal));
    expect(
      within(article)
        .getAllByRole('heading', { level: 1 })
        .map((heading) => heading.id),
    ).toEqual([
      'reader-the-salt-road',
      'reader-chapter-1-arrival',
      'reader-interlude',
      'reader-interlude-2',
    ]);
    expect(article.textContent).toContain('The bell rang twice.');
    // Raw HTML is not prose; code keeps its text, and a # line in code is no heading.
    expect(article.textContent).not.toContain('Generated by story export');
    expect(article.textContent).not.toContain('fix the tide times');
    expect(article.textContent).toContain('<!-- kept in code -->');
    expect(article.textContent).toContain('# Not a heading');

    const user = userEvent.setup();
    await user.click(screen.getByText('Contents', { selector: 'summary' }));
    const buttons = screen
      .getAllByRole('button')
      .filter((button) => button.closest('.reader-contents') !== null)
      .map((button) => button.textContent);
    expect(buttons).toEqual(['The Salt Road', 'Chapter 1: Arrival', 'Interlude', 'Interlude']);

    Element.prototype.scrollIntoView = vi.fn();
    await user.click(screen.getByRole('button', { name: 'Chapter 1: Arrival' }));
    expect(document.activeElement?.id).toBe('reader-chapter-1-arrival');

    expect(screen.getByText('1 note from story export')).toBeTruthy();
    const tabs = screen.getByRole('navigation', { name: 'Book' });
    expect(within(tabs).getByRole('link', { name: 'Reader' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('says there is nothing to read yet for a book without chapters', async () => {
    renderAt('/books/the-salt-road/read', {
      getManuscript: () => Promise.resolve({ markdown: '', warnings: [] }),
    });
    expect(await screen.findByText(/Nothing to read yet/u)).toBeTruthy();
  });

  it('shows a real export failure as an error', async () => {
    renderAt('/books/the-salt-road/read', {
      getManuscript: () =>
        Promise.reject(
          new ApiClientError(409, 'story_unusable_project', 'Cannot export: fix this file first'),
        ),
    });
    expect(await screen.findByText('The manuscript could not be assembled')).toBeTruthy();
    expect(screen.getByText(/Cannot export/u)).toBeTruthy();
  });

  it('has no Reader tab on a series bible', async () => {
    renderAt('/books/the-salt-road/write', {
      getBookTree: () =>
        Promise.resolve({ ...tree, book: { ...book, kind: 'series-bible', seriesId: 'tides' } }),
    });
    const tabs = await screen.findByRole('navigation', { name: 'Book' });
    expect(within(tabs).queryByRole('link', { name: 'Reader' })).toBeNull();
  });
});
