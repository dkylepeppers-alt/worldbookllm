import {
  createSourceSchema,
  createSourcesSchema,
  resourceIdParamsSchema,
} from '@worldbookllm/shared';
import type { FastifyInstance } from 'fastify';

import { InvalidImportError } from '../errors.js';
import { previewSillyTavernJson } from '../services/json-imports.js';

export function registerSourceRoutes(app: FastifyInstance): void {
  app.get('/api/notebooks/:id/sources', (request) => {
    const { id } = resourceIdParamsSchema.parse(request.params);
    return app.services.sources.list(id);
  });

  app.post('/api/notebooks/:id/sources', async (request, reply) => {
    const { id } = resourceIdParamsSchema.parse(request.params);
    const body = createSourceSchema.parse(request.body);
    return reply.status(201).send(app.services.sources.create(id, body));
  });

  app.post('/api/notebooks/:id/source-previews/json', async (request, reply) => {
    const { id } = resourceIdParamsSchema.parse(request.params);
    app.services.sources.list(id);
    const upload = await request.file();
    if (upload === undefined) throw new InvalidImportError('Upload one JSON file.');
    if (!upload.filename.toLowerCase().endsWith('.json')) {
      throw new InvalidImportError('The uploaded file must use the .json extension.');
    }
    if (!['application/json', 'text/json', 'application/octet-stream'].includes(upload.mimetype)) {
      throw new InvalidImportError('The uploaded file must have a JSON media type.');
    }
    const bytes = await upload.toBuffer();
    if (upload.file.truncated) {
      throw new InvalidImportError('The uploaded JSON file exceeds 5 MiB.');
    }
    return reply.send(previewSillyTavernJson(bytes, upload.filename));
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

  app.delete('/api/sources/:id', async (request, reply) => {
    const { id } = resourceIdParamsSchema.parse(request.params);
    app.services.sources.delete(id);
    return reply.status(204).send();
  });
}
