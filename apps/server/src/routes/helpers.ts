import type { FastifyInstance } from 'fastify';
import { ProviderError } from '@worldbookllm/providers';
import { ZodError } from 'zod';

import {
  ConfigurationError,
  ConflictError,
  InvalidImportError,
  NotFoundError,
  ReadOnlyBookPathError,
  StoryCommandError,
  UnsafePathError,
  ValidationError,
} from '../errors.js';

export function installErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, _request, reply) => {
    if (
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      error.statusCode === 413
    ) {
      return reply.status(413).send({
        error: 'payload_too_large',
        message: 'The uploaded file exceeds the allowed size.',
      });
    }

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

    if (error instanceof ValidationError) {
      return reply.status(400).send({ error: 'invalid_request', message: error.message });
    }

    if (error instanceof InvalidImportError) {
      return reply.status(400).send({ error: 'invalid_import', message: error.message });
    }

    if (error instanceof ConfigurationError) {
      return reply.status(409).send({ error: error.code, message: error.message });
    }

    if (error instanceof ConflictError) {
      return reply.status(409).send({ error: error.code, message: error.message });
    }

    if (error instanceof UnsafePathError) {
      return reply.status(400).send({ error: 'unsafe_path', message: error.message });
    }

    if (error instanceof ReadOnlyBookPathError) {
      return reply.status(400).send({ error: 'read_only_path', message: error.message });
    }

    if (error instanceof StoryCommandError) {
      // The story CLI's exit codes: 2 usage error, 3 unusable project, 4 write refused.
      const [status, code] =
        error.exitCode === 2
          ? [400, 'story_usage_error']
          : error.exitCode === 3
            ? [409, 'story_unusable_project']
            : error.exitCode === 4
              ? [409, 'story_write_refused']
              : [422, 'story_command_failed'];
      return reply.status(status).send({ error: code, message: error.message });
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
