import { bookSlugSchema, seriesParamsSchema, seriesSyncSchema } from '@worldbookllm/shared';
import type { FastifyInstance } from 'fastify';

export function registerSeriesRoutes(app: FastifyInstance): void {
  app.delete('/api/series/:id/books/:book', (request) => {
    const params = request.params as { id: string; book: string };
    return app.services.books.removeFromSeries(
      bookSlugSchema.parse(params.book),
      bookSlugSchema.parse(params.id),
    );
  });
  app.post('/api/series/:id/sync', (request) =>
    app.services.series.sync(
      seriesParamsSchema.parse(request.params).id,
      seriesSyncSchema.parse(request.body),
    ),
  );
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
