import { seriesParamsSchema } from '@worldbookllm/shared';
import type { FastifyInstance } from 'fastify';

export function registerSeriesRoutes(app: FastifyInstance): void {
  app.get('/api/series', () => app.services.series.list());
  app.get('/api/series/:id', (request) =>
    app.services.series.get(seriesParamsSchema.parse(request.params).id),
  );
  app.get('/api/series/:id/drift', (request) =>
    app.services.series.drift(seriesParamsSchema.parse(request.params).id),
  );
  app.get('/api/series/:id/health', (request) =>
    app.services.series.health(seriesParamsSchema.parse(request.params).id),
  );
}
