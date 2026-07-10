import { createSourceSchema, resourceIdParamsSchema } from '@worldbookllm/shared';
import type { FastifyInstance } from 'fastify';

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
