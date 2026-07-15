import type { CreatePreset, Preset } from '@worldbookllm/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AppRoutes } from '../App.js';
import { ApiProvider } from '../api/ApiContext.js';
import { ApiClientError } from '../api/client.js';
import { createTestClient } from '../test/createTestClient.js';

const DEFAULT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-07-15T00:00:00.000Z';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function preset(id: string, name: string): Preset {
  return {
    id,
    schemaVersion: 1,
    name,
    generation: { temperature: 0.7, topP: null, maxTokens: null, assistantPrefill: null },
    modules: [
      {
        key: 'sources',
        name: 'Selected sources',
        kind: 'sources',
        role: 'system',
        content: null,
        enabled: true,
        insertion: { position: 'before_history' },
      },
    ],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function renderStudio(overrides = {}, presets = [preset(DEFAULT_ID, 'Grounded development')]) {
  const client = createTestClient({
    listPresets: () => Promise.resolve(presets),
    getAppSettings: () => Promise.resolve({ defaultPresetId: DEFAULT_ID }),
    ...overrides,
  });
  render(
    <ApiProvider client={client}>
      <MemoryRouter initialEntries={['/presets']}>
        <AppRoutes />
      </MemoryRouter>
    </ApiProvider>,
  );
  return client;
}

describe('Preset studio', () => {
  it('loads and selects the global default, retries failures, and handles an empty library', async () => {
    const listPresets = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([]);
    renderStudio({ listPresets });
    const user = userEvent.setup();

    expect(await screen.findByRole('heading', { name: 'Could not load presets' })).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No presets are charted yet.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Create preset' })).toBeDefined();
  });

  it('creates a minimal preset, saves a complete edited patch, sets default, and guards deletion', async () => {
    const base = preset(DEFAULT_ID, 'Grounded development');
    const other = preset(OTHER_ID, 'Prose draft');
    const createPreset = vi.fn().mockResolvedValue(other);
    const updatePreset = vi
      .fn()
      .mockImplementation((_id, patch) => Promise.resolve({ ...other, ...patch, updatedAt: NOW }));
    const updateAppSettings = vi.fn().mockResolvedValue({ defaultPresetId: OTHER_ID });
    const deletePreset = vi.fn().mockResolvedValue(undefined);
    renderStudio({ createPreset, updatePreset, updateAppSettings, deletePreset }, [base]);
    const user = userEvent.setup();

    expect(await screen.findByDisplayValue('Grounded development')).toBeDefined();
    expect(screen.getAllByText('Global default')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Delete preset' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByText('The global default cannot be deleted.')).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Create preset' }));
    expect(createPreset).toHaveBeenCalledWith({
      schemaVersion: 1,
      name: 'Untitled preset',
      generation: { temperature: 0.7, topP: null, maxTokens: null, assistantPrefill: null },
      modules: [expect.objectContaining({ key: 'sources', kind: 'sources' })],
    });
    await user.clear(screen.getByLabelText('Preset name'));
    await user.type(screen.getByLabelText('Preset name'), 'Focused prose');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(updatePreset).toHaveBeenCalledWith(
        OTHER_ID,
        expect.objectContaining({
          name: 'Focused prose',
          generation: other.generation,
          modules: other.modules,
        }),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Make global default' }));
    expect(updateAppSettings).toHaveBeenCalledWith({ defaultPresetId: OTHER_ID });

    await user.click(screen.getByRole('button', { name: 'Select Grounded development' }));
    await user.click(screen.getByRole('button', { name: 'Delete preset' }));
    expect(screen.getByRole('dialog', { name: 'Delete preset?' })).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Delete preset permanently' }));
    expect(deletePreset).toHaveBeenCalledWith(DEFAULT_ID);
  });

  it('preserves nullable generation semantics and the dirty draft after server validation errors', async () => {
    const updatePreset = vi
      .fn()
      .mockRejectedValue(
        new ApiClientError(400, 'validation_error', 'Preset invalid', [
          { code: 'too_small', path: ['name'], message: 'Name is already used' },
        ]),
      );
    renderStudio({ updatePreset });
    const user = userEvent.setup();
    await screen.findByDisplayValue('Grounded development');
    expect(screen.getByText('Assistant prefill (provider-dependent)')).toBeDefined();

    await user.clear(screen.getByLabelText('Preset name'));
    await user.type(screen.getByLabelText('Preset name'), 'Still here');
    await user.clear(screen.getByLabelText('Temperature'));
    await user.type(screen.getByLabelText('Temperature'), '1.25');
    await user.click(screen.getByLabelText('Enable Top P'));
    await user.clear(screen.getByRole('spinbutton', { name: 'Top P' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Top P' }), '0.9');
    await user.click(screen.getByLabelText('Enable Max tokens'));
    await user.clear(screen.getByRole('spinbutton', { name: 'Max tokens' }));
    await user.click(screen.getByLabelText('Enable assistant prefill'));
    await user.type(screen.getByRole('textbox', { name: 'Assistant prefill' }), 'Begin:');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(screen.getByText('Name is already used')).toBeDefined());
    expect(screen.getByDisplayValue('Still here')).toBeDefined();
    expect(updatePreset).toHaveBeenCalledWith(
      DEFAULT_ID,
      expect.objectContaining({
        generation: {
          temperature: 1.25,
          topP: 0.9,
          maxTokens: null,
          assistantPrefill: 'Begin:',
        },
      }),
    );
  });

  it('locks the full studio during save and applies the response only to the saved preset', async () => {
    const saving = deferred<Preset>();
    const base = preset(DEFAULT_ID, 'Default');
    const other = preset(OTHER_ID, 'Other');
    const updatePreset = vi.fn().mockReturnValue(saving.promise);
    renderStudio({ updatePreset }, [base, other]);
    const user = userEvent.setup();

    const name = await screen.findByLabelText('Preset name');
    await user.clear(name);
    await user.type(name, 'Saved draft');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect((name as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Temperature') as HTMLInputElement).disabled).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Add custom module' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Create preset' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Import preset' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Select Other' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.change(name, { target: { value: 'Should not replace draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Select Other' }));
    expect((name as HTMLInputElement).value).toBe('Saved draft');

    saving.resolve({ ...base, name: 'Server canonical name', updatedAt: `${NOW}-new` });
    await waitFor(() => expect(screen.getByDisplayValue('Server canonical name')).toBeDefined());
    expect(screen.getByRole('button', { name: 'Select Other' }).className).not.toContain('active');
    expect(screen.getByRole('button', { name: 'Select Server canonical name' })).toBeDefined();
  });

  it('unlocks after a failed save and retains the dirty draft', async () => {
    const saving = deferred<Preset>();
    renderStudio({ updatePreset: vi.fn().mockReturnValue(saving.promise) });
    const user = userEvent.setup();

    const name = await screen.findByLabelText('Preset name');
    await user.clear(name);
    await user.type(name, 'Retained draft');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    saving.reject(new ApiClientError(500, 'internal_error', 'Save interrupted.'));

    expect(await screen.findByText('Save interrupted.')).toBeDefined();
    expect((screen.getByLabelText('Preset name') as HTMLInputElement).value).toBe('Retained draft');
    expect((screen.getByLabelText('Preset name') as HTMLInputElement).disabled).toBe(false);
    expect(
      (screen.getByRole('button', { name: 'Create preset' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('confirms before abandoning a dirty selection', async () => {
    renderStudio({}, [preset(DEFAULT_ID, 'Default'), preset(OTHER_ID, 'Other')]);
    const user = userEvent.setup();
    await screen.findByDisplayValue('Default');
    await user.type(screen.getByLabelText('Preset name'), ' changed');
    await user.click(screen.getByRole('button', { name: 'Select Other' }));
    expect(screen.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByDisplayValue('Default changed')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Select Other' }));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(await screen.findByDisplayValue('Other')).toBeDefined();
  });

  it('edits custom modules, protects Sources, reorders controls, and previews assembly placeholders', async () => {
    const updatePreset = vi
      .fn()
      .mockImplementation((_id, patch) =>
        Promise.resolve({ ...preset(DEFAULT_ID, 'Default'), ...patch }),
      );
    renderStudio({ updatePreset }, [preset(DEFAULT_ID, 'Default')]);
    const user = userEvent.setup();
    await screen.findByDisplayValue('Default');

    const sources = screen.getByRole('group', { name: 'Selected sources module' });
    expect(within(sources).queryByLabelText('Role')).toBeNull();
    expect(within(sources).queryByRole('button', { name: /remove/i })).toBeNull();
    expect(screen.getByText('system: [Selected source excerpts]')).toBeDefined();
    expect(screen.getByText('[Conversation history]')).toBeDefined();
    expect(screen.getByText('[Newest user message]')).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Add custom module' }));
    const custom = screen.getByRole('group', { name: 'Custom module module' });
    await user.clear(within(custom).getByLabelText('Module name'));
    await user.type(within(custom).getByLabelText('Module name'), 'Style guide');
    await user.type(within(custom).getByLabelText('Content'), 'Use terse prose.');
    await user.click(within(custom).getByLabelText('Enabled'));
    await user.selectOptions(within(custom).getByLabelText('Insertion position'), 'at_depth');
    await user.clear(within(custom).getByLabelText('Depth'));
    await user.type(within(custom).getByLabelText('Depth'), '2');
    await user.click(screen.getByRole('button', { name: 'Move Style guide up' }));
    expect(custom.getAttribute('draggable')).toBeNull();
    const handle = within(custom).getByRole('button', { name: 'Drag Style guide module' });
    expect(handle.getAttribute('draggable')).toBe('true');
    fireEvent.dragStart(handle);
    fireEvent.drop(sources);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(updatePreset).toHaveBeenCalled());
    const patch = updatePreset.mock.calls.at(-1)?.[1];
    expect(patch.modules.map((module: { name: string }) => module.name)).toEqual([
      'Style guide',
      'Selected sources',
    ]);
    expect(screen.getByText('system: Use terse prose. · at depth 2')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Remove Style guide' }));
    expect(screen.queryByRole('group', { name: 'Style guide module' })).toBeNull();
  });

  it('reviews valid native imports and rejects unsupported, oversized, malformed, and schema-invalid files', async () => {
    const imported = preset(OTHER_ID, 'Imported (2)');
    const createPreset = vi.fn().mockResolvedValue(imported);
    renderStudio({ createPreset });
    const user = userEvent.setup();
    await screen.findByDisplayValue('Grounded development');
    await user.click(screen.getByRole('button', { name: 'Import preset' }));
    const input = screen.getByLabelText('Preset JSON file');
    expect(
      screen.getByRole('button', { name: 'Save imported preset' }).hasAttribute('disabled'),
    ).toBe(true);

    fireEvent.change(input, {
      target: { files: [new File(['{}'], 'bad.txt', { type: 'text/plain' })] },
    });
    expect((await screen.findByRole('alert')).textContent).toContain('Choose a .json file');
    fireEvent.change(input, {
      target: { files: [new File(['x'.repeat(1_048_577)], 'large.json')] },
    });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('1 MiB'));
    fireEvent.change(input, { target: { files: [new File(['{'], 'broken.json')] } });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('valid JSON'));
    fireEvent.change(input, {
      target: { files: [new File([JSON.stringify({ unexpected: true })], 'wrong.json')] },
    });
    expect(await screen.findByText(/schemaVersion/)).toBeDefined();

    const valid: CreatePreset = {
      schemaVersion: 1,
      name: 'Imported',
      generation: { temperature: 0.7, topP: null, maxTokens: null, assistantPrefill: 'Opening' },
      modules: [preset(DEFAULT_ID, 'x').modules[0]!],
    };
    fireEvent.change(input, {
      target: { files: [new File([JSON.stringify(valid)], 'valid.json')] },
    });
    expect(await screen.findByText('Imported')).toBeDefined();
    expect(screen.getByText('Temperature 0.7')).toBeDefined();
    expect(screen.getByText('Top P Provider default')).toBeDefined();
    expect(screen.getByText('Max tokens Provider default')).toBeDefined();
    expect(screen.getByText('Assistant prefill (provider-dependent) Opening')).toBeDefined();
    expect(screen.getByText('1 module')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Preset JSON schema' }).getAttribute('href')).toBe(
      '/preset-schema',
    );
    await user.click(screen.getByRole('button', { name: 'Save imported preset' }));
    expect(createPreset).toHaveBeenCalledTimes(1);
    expect(createPreset).toHaveBeenCalledWith(valid);
    expect(await screen.findByDisplayValue('Imported (2)')).toBeDefined();
  });

  it('guards a dirty import before mutation and never changes the global default', async () => {
    const imported = preset(OTHER_ID, 'Imported');
    const createPreset = vi.fn().mockResolvedValue(imported);
    const updateAppSettings = vi.fn();
    renderStudio({ createPreset, updateAppSettings });
    const user = userEvent.setup();
    await screen.findByDisplayValue('Grounded development');
    await user.type(screen.getByLabelText('Preset name'), ' dirty');
    await user.click(screen.getByRole('button', { name: 'Import preset' }));
    const valid: CreatePreset = {
      ...minimalImport(),
      name: 'Imported',
    };
    fireEvent.change(screen.getByLabelText('Preset JSON file'), {
      target: { files: [new File([JSON.stringify(valid)], 'valid.json')] },
    });
    await screen.findByText('Imported');

    await user.click(screen.getByRole('button', { name: 'Save imported preset' }));
    let confirm = screen.getByRole('dialog', { name: 'Discard unsaved changes?' });
    expect(createPreset).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByRole('dialog', { name: 'Import preset' })).toBeDefined();
    expect(createPreset).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Save imported preset' }));
    confirm = screen.getByRole('dialog', { name: 'Discard unsaved changes?' });
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(createPreset).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Import preset' })).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Save imported preset' }));
    confirm = screen.getByRole('dialog', { name: 'Discard unsaved changes?' });
    await user.click(within(confirm).getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(createPreset).toHaveBeenCalledWith(valid));
    expect(await screen.findByDisplayValue('Imported')).toBeDefined();
    expect(updateAppSettings).not.toHaveBeenCalled();
  });

  it('opens the bundled normative schema from the import review link', async () => {
    renderStudio();
    const user = userEvent.setup();
    await screen.findByDisplayValue('Grounded development');
    await user.click(screen.getByRole('button', { name: 'Import preset' }));
    fireEvent.change(screen.getByLabelText('Preset JSON file'), {
      target: { files: [new File([JSON.stringify(minimalImport())], 'valid.json')] },
    });
    await screen.findByText('Imported');

    await user.click(screen.getByRole('link', { name: 'Preset JSON schema' }));
    expect(screen.getByRole('heading', { name: 'Preset schema version 1' })).toBeDefined();
    expect(screen.getByText(/Unknown fields are rejected/)).toBeDefined();
  });

  it('places depth zero, one, and sparse larger boundaries canonically without expanding depth', async () => {
    const withDepths = preset(DEFAULT_ID, 'Depth map');
    withDepths.modules = [
      withDepths.modules[0]!,
      customModule('large-a', 'Large A', 50_000),
      customModule('large-b', 'Large B', 50_000),
      customModule('one', 'Depth one', 1),
      customModule('zero', 'Depth zero', 0),
    ];
    renderStudio({}, [withDepths]);
    await screen.findByDisplayValue('Depth map');

    const rows = Array.from(document.querySelectorAll('.assembly-preview li')).map(
      (item) => item.textContent,
    );
    expect(rows).toEqual([
      'system: [Selected source excerpts]',
      '[Conversation history · older than depth 50000]',
      'system: Large A\n\nLarge B · at depth 50000',
      '[Conversation history · depth 50000 to depth 1]',
      'system: Depth one · at depth 1',
      '[Conversation history · newest message]',
      'system: Depth zero · at depth 0',
      '[Newest user message]',
    ]);
  });

  it('previews the shared canonical coalescing semantics independently at each boundary', async () => {
    const preview = preset(DEFAULT_ID, 'Canonical grouping');
    preview.modules = [
      {
        key: 'before-system',
        name: 'Before system',
        kind: 'custom',
        role: 'system',
        content: 'Before system content',
        enabled: true,
        insertion: { position: 'before_history' },
      },
      preview.modules[0]!,
      {
        key: 'before-user',
        name: 'Before user',
        kind: 'custom',
        role: 'user',
        content: 'Before user content',
        enabled: true,
        insertion: { position: 'before_history' },
      },
      {
        key: 'depth-assistant-a',
        name: 'Depth assistant A',
        kind: 'custom',
        role: 'assistant',
        content: 'Depth assistant A content',
        enabled: true,
        insertion: { position: 'at_depth', depth: 4 },
      },
      {
        key: 'depth-assistant-b',
        name: 'Depth assistant B',
        kind: 'custom',
        role: 'assistant',
        content: 'Depth assistant B content',
        enabled: true,
        insertion: { position: 'at_depth', depth: 4 },
      },
      {
        key: 'depth-system',
        name: 'Depth system',
        kind: 'custom',
        role: 'system',
        content: 'Depth system content',
        enabled: true,
        insertion: { position: 'at_depth', depth: 4 },
      },
    ];
    renderStudio({}, [preview]);
    await screen.findByDisplayValue('Canonical grouping');

    const rows = Array.from(document.querySelectorAll('.assembly-preview li')).map(
      (item) => item.textContent,
    );
    expect(rows).toEqual([
      'system: Before system content\n\n[Selected source excerpts]',
      'user: Before user content',
      '[Conversation history · older than depth 4]',
      'assistant: Depth assistant A content\n\nDepth assistant B content · at depth 4',
      'system: Depth system content · at depth 4',
      '[Conversation history · newest 4 messages]',
      '[Newest user message]',
    ]);
  });
});

function minimalImport(): CreatePreset {
  return {
    schemaVersion: 1,
    name: 'Imported',
    generation: { temperature: 0.7, topP: null, maxTokens: null, assistantPrefill: null },
    modules: [preset(DEFAULT_ID, 'x').modules[0]!],
  };
}

function customModule(key: string, name: string, depth: number): Preset['modules'][number] {
  return {
    key,
    name,
    kind: 'custom',
    role: 'system',
    content: name,
    enabled: true,
    insertion: { position: 'at_depth', depth },
  };
}
