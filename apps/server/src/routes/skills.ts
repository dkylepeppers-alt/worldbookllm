import {
  createSkillSchema,
  installStarterSkillsSchema,
  patchSkillSchema,
  resourceIdParamsSchema,
} from '@worldbookllm/shared';
import type { FastifyInstance } from 'fastify';

export function registerSkillRoutes(app: FastifyInstance): void {
  app.get('/api/skills', () => app.services.skills.list());

  app.post('/api/skills', async (request, reply) =>
    reply.status(201).send(app.services.skills.create(createSkillSchema.parse(request.body))),
  );

  app.get('/api/skills/:id', (request) => {
    const { id } = resourceIdParamsSchema.parse(request.params);
    return app.services.skills.get(id);
  });

  app.patch('/api/skills/:id', (request) => {
    const { id } = resourceIdParamsSchema.parse(request.params);
    return app.services.skills.patch(id, patchSkillSchema.parse(request.body));
  });

  app.delete('/api/skills/:id', async (request, reply) => {
    const { id } = resourceIdParamsSchema.parse(request.params);
    app.services.skills.delete(id);
    return reply.status(204).send();
  });

  app.get('/api/skills-starter', () => app.services.starterSkills.list());

  app.post('/api/skills-starter/install', async (request, reply) => {
    const { starterIds } = installStarterSkillsSchema.parse(request.body);
    return reply.status(201).send(app.services.starterSkills.install(starterIds));
  });
}
