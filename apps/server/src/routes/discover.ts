import {
  bookParamsSchema,
  bookSlugSchema,
  chapterParamsSchema,
  discoverPositionInputSchema,
  draftBeatInputSchema,
  proposalDecisionSchema,
  proposeStoryInputSchema,
  proposeVariablesInputSchema,
  saveDiscoverSetupSchema,
  somethingElseInputSchema,
  writeBeatInputSchema,
} from '@worldbookllm/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const jobParamsSchema = z.strictObject({ book: bookSlugSchema, job: z.string().uuid() });
const draftParamsSchema = jobParamsSchema.extend({ draft: z.string().uuid() });
const proposalParamsSchema = z.strictObject({ book: bookSlugSchema, id: z.string().uuid() });
const seedNoteSchema = z.strictObject({ note: z.string().max(2_000) });

/** Discovering an interactive book by playing it (ADR 0033). */
export function registerDiscoverRoutes(app: FastifyInstance): void {
  const discover = () => app.services.discover;

  app.get('/api/books/:book/discover', (request) => {
    const { book } = bookParamsSchema.parse(request.params);
    return discover().state(book);
  });

  app.put('/api/books/:book/discover/setup', (request) => {
    const { book } = bookParamsSchema.parse(request.params);
    return discover().saveSetup(book, saveDiscoverSetupSchema.parse(request.body));
  });

  app.post('/api/books/:book/discover/variables', (request) => {
    const { book } = bookParamsSchema.parse(request.params);
    return discover().proposeVariables(book, proposeVariablesInputSchema.parse(request.body));
  });

  app.post('/api/books/:book/discover/story', (request) => {
    const { book } = bookParamsSchema.parse(request.params);
    return discover().proposeStory(book, proposeStoryInputSchema.parse(request.body));
  });

  app.post('/api/books/:book/discover/proposals/:id', (request) => {
    const { book, id } = proposalParamsSchema.parse(request.params);
    return discover().decideProposal(book, id, proposalDecisionSchema.parse(request.body));
  });

  app.post('/api/books/:book/discover/position', (request) => {
    const { book } = bookParamsSchema.parse(request.params);
    return discover().position(book, discoverPositionInputSchema.parse(request.body).position);
  });

  app.post('/api/books/:book/discover/write', (request) => {
    const { book } = bookParamsSchema.parse(request.params);
    return discover().writeBeat(book, writeBeatInputSchema.parse(request.body));
  });

  app.post('/api/books/:book/discover/drafts', (request) => {
    const { book } = bookParamsSchema.parse(request.params);
    return discover().draft(book, draftBeatInputSchema.parse(request.body));
  });

  app.post('/api/books/:book/discover/jobs/:job/drafts/:draft', (request) => {
    const { book, job, draft } = draftParamsSchema.parse(request.params);
    return discover().acceptDraft(book, job, draft);
  });

  app.post('/api/books/:book/discover/something-else', (request) => {
    const { book } = bookParamsSchema.parse(request.params);
    return discover().somethingElse(book, somethingElseInputSchema.parse(request.body));
  });

  app.post('/api/books/:book/discover/jobs/:job/retry', (request) => {
    const { book, job } = jobParamsSchema.parse(request.params);
    return discover().retry(book, job);
  });

  app.delete('/api/books/:book/discover/jobs/:job', (request) => {
    const { book, job } = jobParamsSchema.parse(request.params);
    return discover().dismiss(book, job);
  });

  app.post('/api/books/:book/discover/chapters/:id/reviewed', (request) => {
    const { book, id } = chapterParamsSchema.parse(request.params);
    return discover().markReviewed(book, id);
  });

  app.put('/api/books/:book/discover/chapters/:id/note', (request) => {
    const { book, id } = chapterParamsSchema.parse(request.params);
    return discover().setSeedNote(book, id, seedNoteSchema.parse(request.body).note);
  });
}
