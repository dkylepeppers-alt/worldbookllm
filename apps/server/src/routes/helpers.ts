import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

import { NotFoundError } from '../errors.js';

export function installErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: 'validation_error',
        message: 'Invalid request',
        issues: error.issues.map((issue) => ({
          code: issue.code,
          path: issue.path,
          message: issue.message,
        })),
      });
    }

    if (error instanceof NotFoundError) {
      return reply.status(404).send({ error: 'not_found', message: error.message });
    }

    app.log.error(error);
    return reply.status(500).send({
      error: 'internal_error',
      message: 'Internal server error',
    });
  });
}
