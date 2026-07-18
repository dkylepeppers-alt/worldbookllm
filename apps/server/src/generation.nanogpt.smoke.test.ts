import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { buildApp } from './app.js';

const apiKey = process.env.SMOKE_NANOGPT_KEY;
const smoke = apiKey ? it : it.skip;

smoke(
  'streams and persists a live NanoGPT generation through the server API',
  async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'worldbookllm-nanogpt-'));
    const app = buildApp({ dataDir, logger: false });
    try {
      await app.inject({
        method: 'POST',
        url: '/api/secrets',
        payload: { key: 'api_key_nanogpt', value: apiKey, label: 'Smoke' },
      });
      const notebookResponse = await app.inject({
        method: 'POST',
        url: '/api/notebooks',
        payload: {
          name: 'Live smoke',
          settings: {
            source: 'nanogpt',
            model: process.env.SMOKE_NANOGPT_MODEL ?? 'gpt-4o-mini',
          },
        },
      });
      const notebook = notebookResponse.json<{ id: string }>();
      const sourceResponse = await app.inject({
        method: 'POST',
        url: `/api/notebooks/${notebook.id}/sources`,
        payload: { title: 'Instruction', content: 'The required reply word is brass.' },
      });
      const source = sourceResponse.json<{ id: string }>();
      const chatResponse = await app.inject({
        method: 'POST',
        url: `/api/notebooks/${notebook.id}/chats`,
        payload: { sourceIds: [source.id] },
      });
      const chat = chatResponse.json<{ id: string }>();
      const response = await app.inject({
        method: 'POST',
        url: `/api/chats/${chat.id}/messages`,
        payload: { content: 'Reply with exactly: brass' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.body.toLowerCase()).toContain('brass');
      expect(response.body).toContain('event: done');
      const detail = await app.inject({ method: 'GET', url: `/api/chats/${chat.id}` });
      expect(
        detail
          .json<{ messages: Array<{ role: string; content: string; status: string }> }>()
          .messages.at(-1),
      ).toMatchObject({ role: 'assistant', status: 'complete' });
    } finally {
      await app.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  },
  45_000,
);

smoke(
  'suggests organization for an existing source through live NanoGPT',
  async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'worldbookllm-nanogpt-organize-'));
    const app = buildApp({ dataDir, logger: false });
    try {
      await app.inject({
        method: 'POST',
        url: '/api/secrets',
        payload: { key: 'api_key_nanogpt', value: apiKey, label: 'Smoke' },
      });
      const notebookResponse = await app.inject({
        method: 'POST',
        url: '/api/notebooks',
        payload: {
          name: 'Live organize smoke',
          settings: {
            source: 'nanogpt',
            model: process.env.SMOKE_NANOGPT_MODEL ?? 'gpt-4o-mini',
          },
        },
      });
      const notebook = notebookResponse.json<{ id: string }>();
      const sourceResponse = await app.inject({
        method: 'POST',
        url: `/api/notebooks/${notebook.id}/sources`,
        payload: {
          title: 'Captain Mara Voss',
          content:
            'Captain Mara Voss commands the airship Vermilion Wake. She is a veteran of the ' +
            'Brass War, distrusts the Cartographers Guild, and keeps a coded journal of every port.',
        },
      });
      const source = sourceResponse.json<{ id: string }>();
      const response = await app.inject({
        method: 'POST',
        url: `/api/notebooks/${notebook.id}/source-organization-suggestions/existing`,
        payload: { sourceIds: [source.id] },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<{
        suggestions: Array<{ sourceId: string; category: string | null; tags: string[] }>;
        warning: string | null;
      }>();
      expect(body.warning).toBeNull();
      expect(body.suggestions).toHaveLength(1);
      expect(body.suggestions[0]).toMatchObject({ sourceId: source.id });
      expect(body.suggestions[0]?.category).not.toBeNull();
      expect(body.suggestions[0]?.tags.length).toBeGreaterThan(0);
    } finally {
      await app.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  },
  45_000,
);
