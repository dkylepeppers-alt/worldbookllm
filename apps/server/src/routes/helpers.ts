import type { FastifyInstance } from 'fastify';
import { ProviderError } from '@worldbookllm/providers';
import { ZodError } from 'zod';

import { ConfigurationError, ConflictError, NotFoundError } from '../errors.js';

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

    if (error instanceof ConfigurationError) {
      return reply.status(409).send({ error: error.code, message: error.message });
    }

    if (error instanceof ConflictError) {
      return reply.status(409).send({ error: error.code, message: error.message });
    }

    if (error instanceof ProviderError) {
      return reply.status(502).send({ error: 'provider_error', message: error.message });
    }

    app.log.error(error);
    return reply.status(500).send({
      error: 'internal_error',
      message: 'Internal server error',
    });
  });
}
