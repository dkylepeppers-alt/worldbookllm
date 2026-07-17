import {
  SOURCE_ORGANIZATION_MAX_CONTENT,
  type Notebook,
  type SourceDetail,
  type SourceMetadata,
} from '@worldbookllm/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AppRoutes } from '../App.js';
import { ApiProvider } from '../api/ApiContext.js';
import { ApiClientError } from '../api/client.js';
import { createTestClient } from '../test/createTestClient.js';

const notebook: Notebook = {
  id: 'a0c7607c-b365-438b-a7e6-31b2308464b6',
  name: 'Atlas of Ember',
  settings: null,
  createdAt: '2026-07-10T12:00:00.000Z',
  updatedAt: '2026-07-10T12:00:00.000Z',
};

const source: SourceMetadata = {
  id: 'f9942d0a-eaca-41a8-a3d8-87987cc173fd',
  notebookId: notebook.id,
  title: 'The Glass Marsh',
  slug: 'the-glass-marsh',
  filePath: `notebooks/${notebook.id}/sources/f9942d0a-eaca-41a8-a3d8-87987cc173fd-the-glass-marsh.md`,
  origin: { type: 'paste' },
  conversionNotes: [],
  category: null,
  tags: [],
  wordCount: 11,
  contentHash: 'b'.repeat(64),
  createdAt: '2026-07-10T12:00:00.000Z',
  updatedAt: '2026-07-10T12:00:00.000Z',
};

const detail: SourceDetail = {
  ...source,
  content:
    '# The Glass Marsh\n\n- Brine mirrors\n- Reed lanterns\n\n| Tide | Color |\n| --- | --- |\n| Low | Violet |\n\n<script>alert("unsafe")</script>',
};

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

function NavigateProbe({ to }: { to: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(to)}>
      Navigate probe
    </button>
  );
}

function renderPath(path: string, overrides = {}) {
  const client = createTestClient({
    getNotebook: () => Promise.resolve(notebook),
    listSources: () => Promise.resolve([source]),
    getSource: () => Promise.resolve(detail),
    ...overrides,
  });
  return {
    client,
    ...render(
      <ApiProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
          <LocationProbe />
        </MemoryRouter>
      </ApiProvider>,
    ),
  };
}

describe('notebook source workspace', () => {
  it('shows the source index and mobile navigation contract', async () => {
    renderPath(`/notebooks/${notebook.id}`);

    expect(await screen.findByRole('heading', { name: notebook.name })).toBeDefined();
    expect(screen.getByRole('link', { name: source.title }).getAttribute('href')).toBe(
      `/notebooks/${notebook.id}/sources/${source.id}`,
    );
    expect(screen.getByText(/updated jul 10/i)).toBeDefined();
    const mobileNavigation = screen.getByRole('navigation', { name: 'Notebook workspace' });
    expect(mobileNavigation).toBeDefined();
    expect(mobileNavigation.querySelector<HTMLAnchorElement>('a[href="/"]')?.textContent).toBe(
      'Notebooks',
    );
    expect(screen.getByRole('link', { name: 'Sources' })).toBeDefined();
    expect(screen.getByText('Reader').getAttribute('aria-disabled')).toBe('true');

    // Chat is reachable through its own tab; opening it reveals the chat region.
    const chatTab = screen.getByRole('button', { name: 'Chat' });
    await userEvent.setup().click(chatTab);
    expect(await screen.findByRole('heading', { name: 'Develop with AI' })).toBeDefined();
  });

  it('pastes a source and navigates to the server-returned reader', async () => {
    const suggestSourceOrganization = vi.fn().mockResolvedValue({
      suggestions: [{ index: 0, category: 'places', tags: ['glass-marsh'] }],
      warning: null,
    });
    const createSource = vi.fn().mockResolvedValue(source);
    renderPath(`/notebooks/${notebook.id}`, {
      listSources: () => Promise.resolve([]),
      suggestSourceOrganization,
      createSource,
    });

    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Paste source' }));
    expect(screen.getByRole('dialog', { name: 'Paste a Markdown source' })).toBeDefined();
    await user.type(screen.getByRole('textbox', { name: 'Source title' }), source.title);
    await user.type(screen.getByRole('textbox', { name: 'Markdown content' }), '# Marsh lore');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('dialog', { name: 'Review pasted source' })).toBeDefined();
    expect(suggestSourceOrganization).toHaveBeenCalledWith(
      notebook.id,
      {
        drafts: [{ index: 0, title: source.title, content: '# Marsh lore' }],
      },
      expect.any(AbortSignal),
    );
    const tags = screen.getByRole<HTMLInputElement>('textbox', { name: 'Tags' });
    await waitFor(() => expect(tags.value).toBe('glass-marsh'));
    await user.type(tags, ', tides');
    await user.click(screen.getByRole('button', { name: 'Save source' }));

    await waitFor(() =>
      expect(createSource).toHaveBeenCalledWith(notebook.id, {
        title: source.title,
        content: '# Marsh lore',
        category: 'places',
        tags: ['glass-marsh', 'tides'],
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        `/notebooks/${notebook.id}/sources/${source.id}`,
      ),
    );
  });

  it('keeps a pasted source manually organizable when suggestions fail', async () => {
    const suggestSourceOrganization = vi.fn().mockRejectedValue(new Error('provider offline'));
    const createSource = vi.fn().mockResolvedValue(source);
    renderPath(`/notebooks/${notebook.id}`, {
      listSources: () => Promise.resolve([]),
      suggestSourceOrganization,
      createSource,
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Paste source' }));
    await user.type(screen.getByRole('textbox', { name: 'Source title' }), source.title);
    await user.type(screen.getByRole('textbox', { name: 'Markdown content' }), '# Marsh lore');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(
      await screen.findByText("Couldn't suggest organization. You can choose it manually."),
    ).toBeDefined();
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Category' }).value).toBe('');
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Tags' }).value).toBe('');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'misc');
    await user.click(screen.getByRole('button', { name: 'Save source' }));

    await waitFor(() =>
      expect(createSource).toHaveBeenCalledWith(notebook.id, {
        title: source.title,
        content: '# Marsh lore',
        category: 'misc',
        tags: [],
      }),
    );
  });

  it('suggests organization again from the edited pasted source', async () => {
    const suggestSourceOrganization = vi
      .fn()
      .mockResolvedValueOnce({
        suggestions: [{ index: 0, category: 'places', tags: ['glass-marsh'] }],
        warning: null,
      })
      .mockResolvedValueOnce({
        suggestions: [{ index: 0, category: 'lore', tags: ['tide-cycles'] }],
        warning: null,
      });
    renderPath(`/notebooks/${notebook.id}`, {
      listSources: () => Promise.resolve([]),
      suggestSourceOrganization,
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Paste source' }));
    await user.type(screen.getByRole('textbox', { name: 'Source title' }), source.title);
    await user.type(screen.getByRole('textbox', { name: 'Markdown content' }), '# Marsh lore');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('button', { name: 'Back' })).toBeDefined();
    const tags = await screen.findByRole<HTMLInputElement>('textbox', { name: 'Tags' });
    await waitFor(() => expect(tags.value).toBe('glass-marsh'));

    const title = screen.getByRole('textbox', { name: 'Source title' });
    const content = screen.getByRole('textbox', { name: 'Markdown content' });
    await user.clear(title);
    await user.type(title, 'Revised Marsh');
    await user.clear(content);
    await user.type(content, '# Tide cycles');
    await user.clear(tags);
    await user.type(tags, 'manual-tag');
    await user.click(screen.getByRole('button', { name: 'Suggest again' }));

    await waitFor(() => expect(suggestSourceOrganization).toHaveBeenCalledTimes(2));
    expect(suggestSourceOrganization).toHaveBeenLastCalledWith(
      notebook.id,
      {
        drafts: [{ index: 0, title: 'Revised Marsh', content: '# Tide cycles' }],
      },
      expect.any(AbortSignal),
    );
    await waitFor(() => expect(tags.value).toBe('tide-cycles'));
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Category' }).value).toBe(
      'lore',
    );
  });

  it('protects pasted-source organization edits from a late suggestion', async () => {
    let resolveSuggestion!: (value: {
      suggestions: { index: number; category: 'places'; tags: string[] }[];
      warning: null;
    }) => void;
    const suggestSourceOrganization = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveSuggestion = resolve;
      }),
    );
    renderPath(`/notebooks/${notebook.id}`, {
      listSources: () => Promise.resolve([]),
      suggestSourceOrganization,
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Paste source' }));
    await user.type(screen.getByRole('textbox', { name: 'Source title' }), source.title);
    await user.type(screen.getByRole('textbox', { name: 'Markdown content' }), '# Marsh lore');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    const save = screen.getByRole<HTMLButtonElement>('button', { name: 'Save source' });
    expect(save.disabled).toBe(true);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'misc');
    resolveSuggestion({
      suggestions: [{ index: 0, category: 'places', tags: ['glass-marsh'] }],
      warning: null,
    });

    await waitFor(() => expect(save.disabled).toBe(false));
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Category' }).value).toBe(
      'misc',
    );
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Tags' }).value).toBe('');
  });

  it('preserves pasted-source review edits when saving fails', async () => {
    const suggestSourceOrganization = vi.fn().mockResolvedValue({
      suggestions: [{ index: 0, category: 'places', tags: ['glass-marsh'] }],
      warning: null,
    });
    const createSource = vi.fn().mockRejectedValue(new Error('disk full'));
    renderPath(`/notebooks/${notebook.id}`, {
      listSources: () => Promise.resolve([]),
      suggestSourceOrganization,
      createSource,
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Paste source' }));
    await user.type(screen.getByRole('textbox', { name: 'Source title' }), source.title);
    await user.type(screen.getByRole('textbox', { name: 'Markdown content' }), '# Marsh lore');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    const tags = await screen.findByRole<HTMLInputElement>('textbox', { name: 'Tags' });
    await waitFor(() => expect(tags.value).toBe('glass-marsh'));
    await user.type(tags, ', tides');
    await user.click(screen.getByRole('button', { name: 'Save source' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Could not save the source.');
    expect(screen.getByRole('dialog', { name: 'Review pasted source' })).toBeDefined();
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Category' }).value).toBe(
      'places',
    );
    expect(tags.value).toBe('glass-marsh, tides');
  });

  it('reviews a lorebook import with automatic organization and saves each entry', async () => {
    const imported = [
      {
        ...source,
        id: '94747f0e-0e09-4db4-bcb4-82cfba819cc4',
        title: 'Amber Court',
        origin: {
          type: 'file' as const,
          fileName: 'atlas.json',
          mediaType: 'application/json',
        },
        conversionNotes: ['Activation metadata omitted.'],
      },
      {
        ...source,
        id: '52d09203-45d6-4f0c-bfc8-7dad55fda998',
        title: 'Glass Marsh',
        origin: {
          type: 'file' as const,
          fileName: 'atlas.json',
          mediaType: 'application/json',
        },
        conversionNotes: ['Activation metadata omitted.'],
      },
    ];
    const previewFileImport = vi.fn().mockResolvedValue({
      format: 'lorebook',
      origin: { type: 'file', fileName: 'atlas.json', mediaType: 'application/json' },
      entries: [
        { title: 'Amber Court', markdown: 'Amber lore.' },
        { title: 'Glass Marsh', markdown: 'Marsh lore.' },
      ],
      conversionNotes: ['Activation metadata omitted.'],
    });
    const suggestSourceOrganization = vi.fn().mockResolvedValue({
      suggestions: [
        { index: 0, category: 'factions', tags: ['amber-court'] },
        { index: 1, category: 'places', tags: ['glass-marsh'] },
      ],
      warning: null,
    });
    const createSources = vi.fn().mockResolvedValue(imported);
    const { container } = renderPath(`/notebooks/${notebook.id}`, {
      listSources: () => Promise.resolve([]),
      previewFileImport,
      suggestSourceOrganization,
      createSources,
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Import file' }));
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (fileInput === null) throw new Error('file input not found');
    await user.upload(
      fileInput,
      new File(['{"entries":{}}'], 'atlas.json', { type: 'application/json' }),
    );
    expect(await screen.findByRole('heading', { name: 'Review import' })).toBeDefined();
    await waitFor(() => expect(suggestSourceOrganization).toHaveBeenCalledTimes(1));
    const titles = screen.getAllByRole('textbox', { name: 'Source title' });
    await user.clear(titles[0] as HTMLInputElement);
    await user.type(titles[0] as HTMLInputElement, 'Revised Amber Court');
    await user.type(screen.getByRole('textbox', { name: 'Tags for Source 1' }), ', trade-league');
    await user.click(screen.getByRole('button', { name: 'Save 2 sources' }));

    await waitFor(() =>
      expect(createSources).toHaveBeenCalledWith(notebook.id, [
        {
          title: 'Revised Amber Court',
          content: 'Amber lore.',
          origin: { type: 'file', fileName: 'atlas.json', mediaType: 'application/json' },
          conversionNotes: ['Activation metadata omitted.'],
          category: 'factions',
          tags: ['amber-court', 'trade-league'],
        },
        {
          title: 'Glass Marsh',
          content: 'Marsh lore.',
          origin: { type: 'file', fileName: 'atlas.json', mediaType: 'application/json' },
          conversionNotes: ['Activation metadata omitted.'],
          category: 'places',
          tags: ['glass-marsh'],
        },
      ]),
    );
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        `/notebooks/${notebook.id}/sources/${imported[1]?.id}`,
      ),
    );
  });

  it('keeps oversized import batches manually organizable and saveable', async () => {
    const oversizedContent = 'x'.repeat(SOURCE_ORGANIZATION_MAX_CONTENT + 1);
    const previewFileImport = vi.fn().mockResolvedValue({
      format: 'markdown',
      origin: { type: 'file', fileName: 'atlas.md', mediaType: 'text/markdown' },
      entries: [{ title: 'Oversized atlas', markdown: oversizedContent }],
      conversionNotes: [],
    });
    const suggestSourceOrganization = vi.fn();
    const createSources = vi.fn().mockResolvedValue([source]);
    const { container } = renderPath(`/notebooks/${notebook.id}`, {
      listSources: () => Promise.resolve([]),
      previewFileImport,
      suggestSourceOrganization,
      createSources,
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Import file' }));
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (fileInput === null) throw new Error('file input not found');
    await user.upload(fileInput, new File(['# Atlas'], 'atlas.md', { type: 'text/markdown' }));

    expect(await screen.findByRole('heading', { name: 'Review import' })).toBeDefined();
    expect(
      screen.getByText("Couldn't suggest organization. You can choose it manually."),
    ).toBeDefined();
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Category for Source 1' }),
      'lore',
    );
    await user.type(screen.getByRole('textbox', { name: 'Tags for Source 1' }), 'atlas, archive');

    // "Suggest again" re-checks the bounds instead of spending a request
    // that the server would reject.
    await user.click(screen.getByRole('button', { name: 'Suggest again' }));
    expect(suggestSourceOrganization).not.toHaveBeenCalled();
    expect(
      screen.getByText("Couldn't suggest organization. You can choose it manually."),
    ).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Save 1 source' }));
    await waitFor(() =>
      expect(createSources).toHaveBeenCalledWith(notebook.id, [
        {
          title: 'Oversized atlas',
          content: oversizedContent,
          origin: { type: 'file', fileName: 'atlas.md', mediaType: 'text/markdown' },
          conversionNotes: [],
          category: 'lore',
          tags: ['atlas', 'archive'],
        },
      ]),
    );
  });

  it('does not reclassify a pasted source when returning to the review step', async () => {
    const suggestSourceOrganization = vi.fn().mockResolvedValue({
      suggestions: [{ index: 0, category: 'places', tags: ['glass-marsh'] }],
      warning: null,
    });
    renderPath(`/notebooks/${notebook.id}`, {
      listSources: () => Promise.resolve([]),
      suggestSourceOrganization,
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Paste source' }));
    await user.type(screen.getByRole('textbox', { name: 'Source title' }), source.title);
    await user.type(screen.getByRole('textbox', { name: 'Markdown content' }), '# Marsh lore');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    const tags = await screen.findByRole<HTMLInputElement>('textbox', { name: 'Tags' });
    await waitFor(() => expect(tags.value).toBe('glass-marsh'));

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('dialog', { name: 'Review pasted source' })).toBeDefined();
    // Reclassification stays behind the explicit action; Back → Continue is
    // not a request for another provider call.
    expect(suggestSourceOrganization).toHaveBeenCalledTimes(1);
    expect(tags.value).toBe('glass-marsh');
  });

  it('rejects whitespace-only pasted content before requesting suggestions', async () => {
    const suggestSourceOrganization = vi.fn();
    renderPath(`/notebooks/${notebook.id}`, {
      listSources: () => Promise.resolve([]),
      suggestSourceOrganization,
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Paste source' }));
    await user.type(screen.getByRole('textbox', { name: 'Source title' }), source.title);
    await user.type(screen.getByRole('textbox', { name: 'Markdown content' }), '   ');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Paste Markdown content.');
    expect(screen.getByRole('dialog', { name: 'Paste a Markdown source' })).toBeDefined();
    expect(suggestSourceOrganization).not.toHaveBeenCalled();
  });

  it('keeps other entries’ manual edits when suggesting again for one entry', async () => {
    const previewFileImport = vi.fn().mockResolvedValue({
      format: 'lorebook',
      origin: { type: 'file', fileName: 'atlas.json', mediaType: 'application/json' },
      entries: [
        { title: 'Amber Court', markdown: 'Amber lore.' },
        { title: 'Glass Marsh', markdown: 'Marsh lore.' },
      ],
      conversionNotes: [],
    });
    const suggestSourceOrganization = vi
      .fn()
      .mockResolvedValueOnce({
        suggestions: [
          { index: 0, category: 'factions', tags: ['amber-court'] },
          { index: 1, category: 'places', tags: ['glass-marsh'] },
        ],
        warning: null,
      })
      .mockResolvedValueOnce({
        suggestions: [
          { index: 0, category: 'lore', tags: ['amber-history'] },
          { index: 1, category: 'places', tags: ['tide-cycles'] },
        ],
        warning: null,
      });
    const { container } = renderPath(`/notebooks/${notebook.id}`, {
      listSources: () => Promise.resolve([]),
      previewFileImport,
      suggestSourceOrganization,
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Import file' }));
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (fileInput === null) throw new Error('file input not found');
    await user.upload(
      fileInput,
      new File(['{"entries":{}}'], 'atlas.json', { type: 'application/json' }),
    );
    const firstTags = await screen.findByRole<HTMLInputElement>('textbox', {
      name: 'Tags for Source 1',
    });
    await waitFor(() => expect(firstTags.value).toBe('amber-court'));

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Category for Source 1' }),
      'rules',
    );
    const suggestButtons = screen.getAllByRole('button', { name: 'Suggest again' });
    await user.click(suggestButtons[1] as HTMLElement);

    const secondTags = screen.getByRole<HTMLInputElement>('textbox', { name: 'Tags for Source 2' });
    await waitFor(() => expect(secondTags.value).toBe('tide-cycles'));
    // Source 1 was manually edited, so retrying Source 2 leaves it alone.
    expect(
      screen.getByRole<HTMLSelectElement>('combobox', { name: 'Category for Source 1' }).value,
    ).toBe('rules');
    expect(firstTags.value).toBe('amber-court');
  });

  it('closes the chat tab when navigating to a reader route', async () => {
    const client = createTestClient({
      getNotebook: () => Promise.resolve(notebook),
      listSources: () => Promise.resolve([source]),
      getSource: () => Promise.resolve(detail),
    });
    render(
      <ApiProvider client={client}>
        <MemoryRouter initialEntries={[`/notebooks/${notebook.id}`]}>
          <AppRoutes />
          <NavigateProbe to={`/notebooks/${notebook.id}/sources/${source.id}`} />
        </MemoryRouter>
      </ApiProvider>,
    );
    const user = userEvent.setup();

    const chatTab = await screen.findByRole('button', { name: 'Chat' });
    await user.click(chatTab);
    expect(chatTab.getAttribute('aria-pressed')).toBe('true');

    // Programmatic navigation (e.g. after saving an import) must reveal the reader.
    await user.click(screen.getByRole('button', { name: 'Navigate probe' }));

    await waitFor(() => expect(chatTab.getAttribute('aria-pressed')).toBe('false'));
    expect(await screen.findByRole('heading', { name: source.title, level: 1 })).toBeDefined();
  });

  it('dismisses the paste dialog with Escape and restores trigger focus', async () => {
    renderPath(`/notebooks/${notebook.id}`);
    const user = userEvent.setup();
    const trigger = await screen.findByRole('button', { name: 'Paste source' });

    await user.click(trigger);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Source title' }));
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Paste a Markdown source' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('renders safe GFM and exposes the exact raw Markdown', async () => {
    const { container } = renderPath(`/notebooks/${notebook.id}/sources/${source.id}`);
    const user = userEvent.setup();

    expect(await screen.findByRole('heading', { name: source.title, level: 1 })).toBeDefined();
    expect(screen.getByRole('table')).toBeDefined();
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText(source.filePath)).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.getByRole('region', { name: 'Raw Markdown' }).textContent).toContain(
      '<script>alert("unsafe")</script>',
    );
  });

  it('deletes the active source and returns to its index', async () => {
    const deleteSource = vi.fn().mockResolvedValue(undefined);
    renderPath(`/notebooks/${notebook.id}/sources/${source.id}`, { deleteSource });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: `Delete ${source.title}` }));
    expect(screen.getByRole('dialog', { name: 'Delete source?' })).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Delete source' }));

    await waitFor(() => expect(deleteSource).toHaveBeenCalledWith(source.id));
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(`/notebooks/${notebook.id}`),
    );
  });

  it('keeps notebook and source failures distinct and retryable', async () => {
    const listSources = vi
      .fn()
      .mockRejectedValueOnce(new ApiClientError(500, 'internal_error', 'Internal server error'))
      .mockResolvedValueOnce([]);
    renderPath(`/notebooks/${notebook.id}`, { listSources });
    const user = userEvent.setup();

    expect(await screen.findByRole('heading', { name: 'Could not load sources' })).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/no sources plotted/i)).toBeDefined();
    expect(listSources).toHaveBeenCalledTimes(2);
  });

  it('renders notebook and reader not-found states', async () => {
    const { unmount } = renderPath(`/notebooks/${notebook.id}`, {
      getNotebook: () => Promise.reject(new ApiClientError(404, 'not_found', 'Notebook not found')),
    });
    expect(await screen.findByRole('heading', { name: 'Notebook not found' })).toBeDefined();
    unmount();

    renderPath(`/notebooks/${notebook.id}/sources/${source.id}`, {
      getSource: () => Promise.reject(new ApiClientError(404, 'not_found', 'Source not found')),
    });
    expect(await screen.findByRole('heading', { name: 'Source not found' })).toBeDefined();
  });

  it('rejects a source detail that belongs to another notebook', async () => {
    renderPath(`/notebooks/${notebook.id}/sources/${source.id}`, {
      getSource: () =>
        Promise.resolve({
          ...detail,
          notebookId: 'a55cb9f0-4776-47b3-91d4-51dd5651e8e8',
        }),
    });

    expect(await screen.findByRole('heading', { name: 'Source not found' })).toBeDefined();
    expect(screen.queryByRole('heading', { name: source.title })).toBeNull();
  });
});
