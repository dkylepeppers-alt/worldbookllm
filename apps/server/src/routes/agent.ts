import {
  agentChatParamsSchema,
  bookParamsSchema,
  createAgentChatSchema,
  encodeAgentSseEvent,
  sendAgentMessageSchema,
} from '@worldbookllm/shared';
import type { FastifyInstance } from 'fastify';

/** Agent chats on books (ADR 0015); turns stream as server-sent events. */
export function registerAgentRoutes(app: FastifyInstance): void {
  const agent = () => app.services.agent;

  app.get('/api/books/:book/agent-chats', (request) => {
    const { book } = bookParamsSchema.parse(request.params);
    return agent().listChats(book);
  });

  app.post('/api/books/:book/agent-chats', async (request, reply) => {
    const { book } = bookParamsSchema.parse(request.params);
    const { title } = createAgentChatSchema.parse(request.body ?? {});
    return reply.status(201).send(agent().createChat(book, title));
  });

  app.get('/api/agent-chats/:id', (request) => {
    const { id } = agentChatParamsSchema.parse(request.params);
    return agent().getChat(id);
  });

  app.delete('/api/agent-chats/:id', async (request, reply) => {
    const { id } = agentChatParamsSchema.parse(request.params);
    agent().deleteChat(id);
    return reply.status(204).send();
  });

  app.post('/api/agent-chats/:id/messages', async (request, reply) => {
    const { id } = agentChatParamsSchema.parse(request.params);
    const { content } = sendAgentMessageSchema.parse(request.body);
    const prepared = agent().prepare(id, content);
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
      await agent().run(prepared, controller.signal, (event) => {
        if (!reply.raw.destroyed) reply.raw.write(encodeAgentSseEvent(event));
      });
    } finally {
      reply.raw.off('close', onClose);
      prepared.release();
      if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end();
    }
  });

  app.post('/api/skills-story/install', async (_request, reply) =>
    reply.status(201).send(app.services.storySkills.install()),
  );
}
