import {
  addEntitySchema,
  addSeriesBookSchema,
  bookBuildParamsSchema,
  bookCheckParamsSchema,
  bookCheckQuerySchema,
  bookFilePathSchema,
  bookParamsSchema,
  bookSearchQuerySchema,
  checkpointParamsSchema,
  createBookBuildSchema,
  createBookImportSchema,
  createBookSchema,
  createSeriesSchema,
  entityParamsSchema,
  moveBookToSeriesSchema,
  moveEntitySchema,
  renameEntitySchema,
  writeBookFileSchema,
} from '@worldbookllm/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { InvalidImportError } from '../errors.js';
import { buildContentType } from '../story/book-builds.js';

function filePath(params: unknown): string {
  return bookFilePathSchema.parse((params as Record<string, unknown>)['*']);
}

/** Reads the single uploaded file of a multipart request, with the source-upload limits. */
async function readUpload(request: FastifyRequest): Promise<{ bytes: Buffer; fileName: string }> {
  const upload = await request.file();
  if (upload === undefined) throw new InvalidImportError('Upload one file.');
  const fileName = upload.filename.trim();
  if (fileName === '' || fileName.length > 255) {
    throw new InvalidImportError('The uploaded file name must be between 1 and 255 characters.');
  }
  const bytes = await upload.toBuffer();
  if (upload.file.truncated) throw new InvalidImportError('The uploaded file exceeds 25 MiB.');
  return { bytes, fileName };
}

/** Story-skills books (ADR 0014). */
export function registerBookRoutes(app: FastifyInstance): void {
  const books = () => app.services.books;

  app.get('/api/books', () => books().list());
  app.get('/api/books/conflicts', () => books().conflicts());

  app.post('/api/books', async (request, reply) =>
    reply.status(201).send(await books().create(createBookSchema.parse(request.body))),
  );

  // A manuscript (.md, .txt) is split into chapters; a .zip is a whole story-skills project.
  app.post('/api/books/import', async (request, reply) => {
    const { bytes, fileName } = await readUpload(request);
    const result = /\.zip$/iu.test(fileName)
      ? await books().importProject(bytes, fileName)
      : await books().importManuscript(bytes, fileName);
    return reply.status(201).send(result);
  });

  app.post('/api/books/:book/previews/file', async (request) => {
    const { book } = bookParamsSchema.parse(request.params);
    books().get(book);
    const { bytes, fileName } = await readUpload(request);
    return books().previewImport(book, bytes, fileName);
  });

  app.post('/api/books/:book/imports', async (request, reply) => {
    const { book } = bookParamsSchema.parse(request.params);
    const input = createBookImportSchema.parse(request.body);
    return reply.status(201).send(await books().importEntries(book, input));
  });

  app.get('/api/books/:book', (request) => {
    const { book } = bookParamsSchema.parse(request.params);
    return books().get(book);
  });

  // Series (ADR 0018): a series bible is addressed like a book, by the series id.
  app.post('/api/series', async (request, reply) =>
    reply.status(201).send(await books().createSeries(createSeriesSchema.parse(request.body))),
  );

  app.post('/api/series/:book/books', async (request, reply) => {
    const { book: seriesId } = bookParamsSchema.parse(request.params);
    const input = addSeriesBookSchema.parse(request.body);
    return reply.status(201).send(await books().addToSeries(seriesId, input));
  });

  app.post('/api/books/:book/series', async (request) => {
    const { book } = bookParamsSchema.parse(request.params);
    const input = moveBookToSeriesSchema.parse(request.body);
    return 'seriesId' in input
      ? books().moveIntoSeries(book, input.seriesId)
      : books().moveIntoNewSeries(book, input.newSeriesTitle);
  });

  app.post('/api/books/:book/convert-to-series', async (request) => {
    const { book } = bookParamsSchema.parse(request.params);
    const { title } = createSeriesSchema.parse(request.body);
    return books().moveIntoNewSeries(book, title);
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
    return books().check(book, command, false, bookCheckQuerySchema.parse(request.query));
  });

  app.get('/api/books/:book/manuscript', (request) => {
    const { book } = bookParamsSchema.parse(request.params);
    return books().manuscript(book);
  });

  app.get('/api/books/:book/builds', (request) => {
    const { book } = bookParamsSchema.parse(request.params);
    return books().listBuilds(book);
  });

  app.post('/api/books/:book/builds', async (request, reply) => {
    const { book } = bookParamsSchema.parse(request.params);
    const input = createBookBuildSchema.parse(request.body);
    return reply.status(201).send(await books().build(book, input));
  });

  app.get('/api/books/:book/builds/:file', async (request, reply) => {
    const { book, file } = bookBuildParamsSchema.parse(request.params);
    const bytes = await books().readBuild(book, file);
    // Downloads only: a built HTML review copy must never run as a page of this origin.
    return reply
      .header('content-type', buildContentType(file))
      .header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file)}`)
      .header('content-security-policy', "sandbox; default-src 'none'")
      .header('x-content-type-options', 'nosniff')
      .send(bytes);
  });

  app.delete('/api/books/:book/builds/:file', async (request, reply) => {
    const { book, file } = bookBuildParamsSchema.parse(request.params);
    await books().removeBuild(book, file);
    return reply.status(204).send();
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
