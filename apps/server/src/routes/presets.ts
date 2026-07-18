import {
  createPresetSchema,
  patchAppSettingsSchema,
  patchPresetSchema,
  resourceIdParamsSchema,
} from '@worldbookllm/shared';
import type { FastifyInstance } from 'fastify';

export function registerPresetRoutes(app: FastifyInstance): void {
  app.get('/api/presets', () => app.services.presets.list());

  app.post('/api/presets', async (request, reply) =>
    reply.status(201).send(app.services.presets.create(createPresetSchema.parse(request.body))),
  );

  app.get('/api/presets/:id', (request) => {
    const { id } = resourceIdParamsSchema.parse(request.params);
    return app.services.presets.get(id);
  });

  app.patch('/api/presets/:id', (request) => {
    const { id } = resourceIdParamsSchema.parse(request.params);
    return app.services.presets.patch(id, patchPresetSchema.parse(request.body));
  });

  app.delete('/api/presets/:id', async (request, reply) => {
    const { id } = resourceIdParamsSchema.parse(request.params);
    app.services.presets.delete(id);
    return reply.status(204).send();
  });

  app.get('/api/app-settings', () => app.services.presets.getSettings());

  app.patch('/api/app-settings', (request) => {
    return app.services.presets.updateSettings(patchAppSettingsSchema.parse(request.body));
  });
}
