import { connectionTestRequestSchema, modelListRequestSchema } from '@worldbookllm/shared';
import type { FastifyInstance } from 'fastify';

export function registerProviderRoutes(app: FastifyInstance): void {
  app.get('/api/providers', () => app.services.providers.getCatalog());

  app.post('/api/providers/models', async (request) => {
    const connection = modelListRequestSchema.parse(request.body);
    return { models: await app.services.providers.listModels(connection) };
  });

  app.post('/api/providers/test', async (request) => {
    const config = connectionTestRequestSchema.parse(request.body);
    return app.services.providers.testConnection(config);
  });
}
