import {
  createNotebookSchema,
  patchNotebookSchema,
  resourceIdParamsSchema,
} from '@worldbookllm/shared';
import type { FastifyInstance } from 'fastify';

export function registerNotebookRoutes(app: FastifyInstance): void {
  app.get('/api/notebooks', () => app.services.notebooks.list());

  app.post('/api/notebooks', async (request, reply) => {
    const body = createNotebookSchema.parse(request.body);
    return reply.status(201).send(app.services.notebooks.create(body));
  });

  app.get('/api/notebooks/:id', (request) => {
    const { id } = resourceIdParamsSchema.parse(request.params);
    return app.services.notebooks.get(id);
  });

  app.patch('/api/notebooks/:id', (request) => {
    const { id } = resourceIdParamsSchema.parse(request.params);
    const body = patchNotebookSchema.parse(request.body);
    return app.services.notebooks.patch(id, body);
  });

  app.delete('/api/notebooks/:id', async (request, reply) => {
    const { id } = resourceIdParamsSchema.parse(request.params);
    app.services.notebooks.delete(id);
    return reply.status(204).send();
  });
}
