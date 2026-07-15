import {
  createChatSchema,
  createMessageSchema,
  encodeSseEvent,
  patchChatSchema,
  resourceIdParamsSchema,
} from '@worldbookllm/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';

import type { PreparedGeneration } from '../services/generation.js';

async function streamPrepared(
  app: FastifyInstance,
  reply: FastifyReply,
  prepared: PreparedGeneration,
): Promise<void> {
  const controller = new AbortController();
  const onClose = () => controller.abort();
  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  reply.raw.once('close', onClose);
  try {
    await app.services.generation.stream(prepared, controller.signal, (event) => {
      if (!reply.raw.destroyed) reply.raw.write(encodeSseEvent(event));
    });
  } finally {
    reply.raw.off('close', onClose);
    prepared.release();
    if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end();
  }
}

export function registerChatRoutes(app: FastifyInstance): void {
  app.get('/api/notebooks/:id/chats', (request) => {
    const { id } = resourceIdParamsSchema.parse(request.params);
    return app.services.chats.list(id);
  });
  app.post('/api/notebooks/:id/chats', async (request, reply) => {
    const { id } = resourceIdParamsSchema.parse(request.params);
    return reply
      .status(201)
      .send(app.services.chats.create(id, createChatSchema.parse(request.body)));
  });
  app.get('/api/chats/:id', (request) => {
    const { id } = resourceIdParamsSchema.parse(request.params);
    return app.services.chats.getDetail(id);
  });
  app.patch('/api/chats/:id', (request) => {
    const { id } = resourceIdParamsSchema.parse(request.params);
    return app.services.chats.patch(id, patchChatSchema.parse(request.body));
  });
  app.delete('/api/chats/:id', async (request, reply) => {
    const { id } = resourceIdParamsSchema.parse(request.params);
    app.services.chats.delete(id);
    return reply.status(204).send();
  });

  app.post('/api/chats/:id/messages', async (request, reply) => {
    const { id } = resourceIdParamsSchema.parse(request.params);
    const { content } = createMessageSchema.parse(request.body);
    const prepared = app.services.generation.prepare(id, content);
    await streamPrepared(app, reply, prepared);
  });

  app.post('/api/chats/:id/regenerate', async (request, reply) => {
    const { id } = resourceIdParamsSchema.parse(request.params);
    const prepared = app.services.generation.prepareRegeneration(id);
    await streamPrepared(app, reply, prepared);
  });
}
