import { patchAppSettingsSchema } from '@worldbookllm/shared';
import type { FastifyInstance } from 'fastify';

/** App-wide settings and the one-time notebook migration report (ADR 0017). */
export function registerSettingsRoutes(app: FastifyInstance): void {
  app.get('/api/app-settings', () => app.services.settings.getSettings());

  app.patch('/api/app-settings', (request) =>
    app.services.settings.updateSettings(patchAppSettingsSchema.parse(request.body)),
  );

  app.get('/api/notebook-migration', () => app.services.notebookMigration.report());

  app.post('/api/notebook-migration/seen', async (_request, reply) => {
    app.services.settings.markNotebookMigrationSeen();
    return reply.status(204).send();
  });
}
