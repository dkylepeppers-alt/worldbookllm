import {
  createSourceSchema,
  createSourcesSchema,
  existingSourceOrganizationRequestSchema,
  patchSourceSchema,
  resourceIdParamsSchema,
  sourceOrganizationRequestSchema,
  sourceSearchQuerySchema,
} from '@worldbookllm/shared';
import type { FastifyInstance } from 'fastify';

import { InvalidImportError } from '../errors.js';
import { convertUpload } from '../services/converters/index.js';

export function registerSourceRoutes(app: FastifyInstance): void {
  app.get('/api/notebooks/:id/sources', (request) => {
    const { id } = resourceIdParamsSchema.parse(request.params);
    return app.services.sources.list(id);
  });

  app.get('/api/notebooks/:id/sources/search', (request) => {
    const { id } = resourceIdParamsSchema.parse(request.params);
    const { q } = sourceSearchQuerySchema.parse(request.query);
    return app.services.sources.search(id, q);
  });

  app.post('/api/notebooks/:id/source-organization-suggestions', async (request, reply) => {
    const { id } = resourceIdParamsSchema.parse(request.params);
    const { drafts } = sourceOrganizationRequestSchema.parse(request.body);
    // A closed connection means nobody is waiting for the suggestion, so
    // cancel the in-flight provider completion instead of paying for it.
    const controller = new AbortController();
    const onClose = () => controller.abort();
    reply.raw.once('close', onClose);
    try {
      return await app.services.sourceOrganization.suggest(id, drafts, controller.signal);
    } finally {
      reply.raw.off('close', onClose);
    }
  });

  app.post(
    '/api/notebooks/:id/source-organization-suggestions/existing',
    async (request, reply) => {
      const { id } = resourceIdParamsSchema.parse(request.params);
      const { sourceIds } = existingSourceOrganizationRequestSchema.parse(request.body);
      // A closed connection means nobody is waiting for the suggestion, so
      // cancel the in-flight provider completion instead of paying for it.
      const controller = new AbortController();
      const onClose = () => controller.abort();
      reply.raw.once('close', onClose);
      try {
        return await app.services.sourceOrganization.suggestForSources(
          id,
          sourceIds,
          controller.signal,
        );
      } finally {
        reply.raw.off('close', onClose);
      }
    },
  );

  app.post('/api/notebooks/:id/sources', async (request, reply) => {
    const { id } = resourceIdParamsSchema.parse(request.params);
    const body = createSourceSchema.parse(request.body);
    return reply.status(201).send(app.services.sources.create(id, body));
  });

  app.post('/api/notebooks/:id/source-previews/file', async (request, reply) => {
    const { id } = resourceIdParamsSchema.parse(request.params);
    app.services.notebooks.get(id);
    const upload = await request.file();
    if (upload === undefined) throw new InvalidImportError('Upload one file.');
    const fileName = upload.filename.trim();
    if (fileName === '' || fileName.length > 255) {
      throw new InvalidImportError('The uploaded file name must be between 1 and 255 characters.');
    }
    const bytes = await upload.toBuffer();
    if (upload.file.truncated) {
      throw new InvalidImportError('The uploaded file exceeds 25 MiB.');
    }
    return reply.send(await convertUpload(bytes, fileName));
  });

  app.post('/api/notebooks/:id/sources/batch', async (request, reply) => {
    const { id } = resourceIdParamsSchema.parse(request.params);
    const body = createSourcesSchema.parse(request.body);
    return reply.status(201).send(app.services.sources.createMany(id, body));
  });

  app.get('/api/sources/:id', (request) => {
    const { id } = resourceIdParamsSchema.parse(request.params);
    return app.services.sources.get(id);
  });

  app.patch('/api/sources/:id', (request) => {
    const { id } = resourceIdParamsSchema.parse(request.params);
    const body = patchSourceSchema.parse(request.body);
    return app.services.sources.patch(id, body);
  });

  app.delete('/api/sources/:id', async (request, reply) => {
    const { id } = resourceIdParamsSchema.parse(request.params);
    app.services.sources.delete(id);
    return reply.status(204).send();
  });
}
