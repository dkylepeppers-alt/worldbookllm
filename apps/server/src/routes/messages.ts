import { patchMessageSchema, resourceIdParamsSchema } from '@worldbookllm/shared';
import type { FastifyInstance } from 'fastify';

export function registerMessageRoutes(app: FastifyInstance): void {
  app.patch('/api/messages/:id', (request) => {
    const { id } = resourceIdParamsSchema.parse(request.params);
    const { activeVariant } = patchMessageSchema.parse(request.body);
    return app.services.chats.selectVariant(id, activeVariant);
  });
}
