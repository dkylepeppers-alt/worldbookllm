import {
  agentChangesetParamsSchema,
  agentChatParamsSchema,
  bookParamsSchema,
  createAgentChatSchema,
  createCustomAgentSchema,
  customAgentParamsSchema,
  encodeAgentSseEvent,
  patchAgentChatSchema,
  patchCustomAgentSchema,
  resolveAgentChangesetSchema,
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
    const input = createAgentChatSchema.parse(request.body ?? {});
    return reply.status(201).send(agent().createChat(book, input));
  });

  app.get('/api/agent-chats/:id', (request) => {
    const { id } = agentChatParamsSchema.parse(request.params);
    return agent().getChat(id);
  });

  app.patch('/api/agent-chats/:id', (request) => {
    const { id } = agentChatParamsSchema.parse(request.params);
    return agent().patchChat(id, patchAgentChatSchema.parse(request.body));
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

  // Review mode: a turn's proposed changes, applied or skipped per file (ADR 0016).
  app.get('/api/agent-changesets/:id', (request) => {
    const { id } = agentChangesetParamsSchema.parse(request.params);
    return app.services.changesets.detail(id);
  });

  app.post('/api/agent-changesets/:id/apply', (request) => {
    const { id } = agentChangesetParamsSchema.parse(request.params);
    const { paths } = resolveAgentChangesetSchema.parse(request.body ?? {});
    return app.services.changesets.apply(id, paths);
  });

  app.post('/api/agent-changesets/:id/skip', (request) => {
    const { id } = agentChangesetParamsSchema.parse(request.params);
    const { paths } = resolveAgentChangesetSchema.parse(request.body ?? {});
    return app.services.changesets.skip(id, paths);
  });

  // Saved custom agents.
  app.get('/api/agents', () => app.services.customAgents.list());

  app.post('/api/agents', async (request, reply) =>
    reply
      .status(201)
      .send(app.services.customAgents.create(createCustomAgentSchema.parse(request.body))),
  );

  app.get('/api/agents/:id', (request) => {
    const { id } = customAgentParamsSchema.parse(request.params);
    return app.services.customAgents.get(id);
  });

  app.patch('/api/agents/:id', (request) => {
    const { id } = customAgentParamsSchema.parse(request.params);
    return app.services.customAgents.patch(id, patchCustomAgentSchema.parse(request.body));
  });

  app.delete('/api/agents/:id', async (request, reply) => {
    const { id } = customAgentParamsSchema.parse(request.params);
    app.services.customAgents.delete(id);
    return reply.status(204).send();
  });

  app.post('/api/skills-story/install', async (_request, reply) =>
    reply.status(201).send(app.services.storySkills.install()),
  );
}
