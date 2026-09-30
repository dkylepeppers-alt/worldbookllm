import {
  addEntitySchema,
  bookCheckParamsSchema,
  bookFilePathSchema,
  bookParamsSchema,
  bookSearchQuerySchema,
  checkpointParamsSchema,
  createBookSchema,
  entityParamsSchema,
  moveEntitySchema,
  renameEntitySchema,
  writeBookFileSchema,
} from '@worldbookllm/shared';
import type { FastifyInstance } from 'fastify';

function filePath(params: unknown): string {
  return bookFilePathSchema.parse((params as Record<string, unknown>)['*']);
}

/** Story-skills books (ADR 0014). */
export function registerBookRoutes(app: FastifyInstance): void {
  const books = () => app.services.books;

  app.get('/api/books', () => books().list());

  app.post('/api/books', async (request, reply) =>
    reply.status(201).send(await books().create(createBookSchema.parse(request.body))),
  );

  app.get('/api/books/:book', (request) => {
    const { book } = bookParamsSchema.parse(request.params);
    return books().get(book);
  });

  app.delete('/api/books/:book', async (request, reply) => {
    const { book } = bookParamsSchema.parse(request.params);
    await books().trash(book);
    return reply.status(204).send();
  });

  app.get('/api/books/:book/tree', (request) => {
    const { book } = bookParamsSchema.parse(request.params);
    return books().tree(book);
  });

  app.get('/api/books/:book/files/*', (request) => {
    const { book } = bookParamsSchema.parse({ book: (request.params as { book: string }).book });
    return books().readFile(book, filePath(request.params));
  });

  app.put('/api/books/:book/files/*', async (request) => {
    const { book } = bookParamsSchema.parse({ book: (request.params as { book: string }).book });
    return books().writeFile(
      book,
      filePath(request.params),
      writeBookFileSchema.parse(request.body),
    );
  });

  app.get('/api/books/:book/search', (request) => {
    const { book } = bookParamsSchema.parse(request.params);
    const { q } = bookSearchQuerySchema.parse(request.query);
    return books().search(book, q);
  });

  app.post('/api/books/:book/entities', async (request, reply) => {
    const { book } = bookParamsSchema.parse(request.params);
    return reply
      .status(201)
      .send(await books().addEntity(book, addEntitySchema.parse(request.body)));
  });

  app.post('/api/books/:book/entities/:kind/:id/rename', async (request) => {
    const { book, kind, id } = entityParamsSchema.parse(request.params);
    return books().renameEntity(book, kind, id, renameEntitySchema.parse(request.body));
  });

  app.post('/api/books/:book/entities/:kind/:id/move', async (request) => {
    const { book, kind, id } = entityParamsSchema.parse(request.params);
    return books().moveEntity(book, kind, id, moveEntitySchema.parse(request.body));
  });

  app.delete('/api/books/:book/entities/:kind/:id', async (request) => {
    const { book, kind, id } = entityParamsSchema.parse(request.params);
    return books().removeEntity(book, kind, id);
  });

  app.get('/api/books/:book/checks/:command', (request) => {
    const { book, command } = bookCheckParamsSchema.parse(request.params);
    return books().check(book, command);
  });

  app.get('/api/books/:book/checkpoints', (request) => {
    const { book } = bookParamsSchema.parse(request.params);
    return books().listCheckpoints(book);
  });

  app.get('/api/books/:book/checkpoints/:id', (request) => {
    const { book, id } = checkpointParamsSchema.parse(request.params);
    return books().checkpointDetail(book, id);
  });

  app.post('/api/books/:book/checkpoints/:id/undo', (request) => {
    const { book, id } = checkpointParamsSchema.parse(request.params);
    return books().undo(book, id);
  });
}
