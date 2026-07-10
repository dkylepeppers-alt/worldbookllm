import { createSecretSchema, secretParamsSchema } from '@worldbookllm/shared';
import type { FastifyInstance } from 'fastify';

export function registerSecretRoutes(app: FastifyInstance): void {
  app.get('/api/secrets', () => app.services.secrets.getState());

  app.post('/api/secrets', async (request, reply) => {
    const body = createSecretSchema.parse(request.body);
    return reply.status(201).send(app.services.secrets.add(body.key, body.value, body.label));
  });

  app.post('/api/secrets/:key/:id/activate', async (request, reply) => {
    const { key, id } = secretParamsSchema.parse(request.params);
    app.services.secrets.activate(key, id);
    return reply.status(204).send();
  });

  app.delete('/api/secrets/:key/:id', async (request, reply) => {
    const { key, id } = secretParamsSchema.parse(request.params);
    app.services.secrets.delete(key, id);
    return reply.status(204).send();
  });
}
