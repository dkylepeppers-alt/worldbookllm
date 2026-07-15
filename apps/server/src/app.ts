import { existsSync } from 'node:fs';

import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';

import { openDatabase } from './db/database.js';
import { resolveDataDir, resolveWebDistDir } from './env.js';
import { SourceFileStore } from './files/source-files.js';
import { ProviderHttpClient } from './providers/http-client.js';
import { installErrorHandler } from './routes/helpers.js';
import { registerChatRoutes } from './routes/chats.js';
import { registerMessageRoutes } from './routes/messages.js';
import { registerNotebookRoutes } from './routes/notebooks.js';
import { registerProviderRoutes } from './routes/providers.js';
import { registerPresetRoutes } from './routes/presets.js';
import { registerSecretRoutes } from './routes/secrets.js';
import { registerSourceRoutes } from './routes/sources.js';
import { SecretStore } from './secrets/secret-store.js';
import { ChatService } from './services/chats.js';
import { GenerationService } from './services/generation.js';
import { NotebookService } from './services/notebooks.js';
import { PromptAssembler } from './services/prompt-assembler.js';
import { ProviderService } from './services/providers.js';
import { PresetService } from './services/presets.js';
import { UPLOAD_LIMIT_BYTES } from './services/converters/limits.js';
import { SourceService } from './services/sources.js';

export interface AppServices {
  notebooks: NotebookService;
  sources: SourceService;
  secrets: SecretStore;
  providers: ProviderService;
  presets: PresetService;
  chats: ChatService;
  generation: GenerationService;
}

declare module 'fastify' {
  interface FastifyInstance {
    services: AppServices;
  }
}

export interface BuildAppOptions {
  dataDir?: string;
  logger?: boolean;
  fetchImpl?: typeof fetch;
  /** Built web app to serve in production (ADR 0002); defaults via resolveWebDistDir. */
  webDistDir?: string;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? process.env.NODE_ENV !== 'test' });
  const dataDir = resolveDataDir(options.dataDir);
  const db = openDatabase(dataDir);
  const sourceFiles = new SourceFileStore(dataDir);
  const secrets = new SecretStore(dataDir);
  const providers = new ProviderService(
    secrets,
    new ProviderHttpClient(options.fetchImpl ?? globalThis.fetch),
  );
  const chats = new ChatService(db);
  const presets = new PresetService(db);
  const notebooks = new NotebookService(db, sourceFiles);
  const sources = new SourceService(db, sourceFiles);
  const generation = new GenerationService(
    chats,
    notebooks,
    presets,
    new PromptAssembler(sources),
    providers,
    (error) => app.log.error(error),
  );

  app.decorate('services', {
    notebooks,
    sources,
    secrets,
    providers,
    presets,
    chats,
    generation,
  });

  app.addHook('onClose', () => {
    if (db.open) db.close();
  });

  installErrorHandler(app);
  app.register(multipart, {
    limits: {
      files: 1,
      fileSize: UPLOAD_LIMIT_BYTES,
      fields: 0,
      parts: 1,
    },
  });

  app.get('/api/health', () => ({ status: 'ok' }));

  registerNotebookRoutes(app);
  registerSourceRoutes(app);
  registerSecretRoutes(app);
  registerProviderRoutes(app);
  registerPresetRoutes(app);
  registerChatRoutes(app);
  registerMessageRoutes(app);

  // One process, one port in production (ADR 0002): serve the built web app
  // if it exists, with an SPA fallback so client-side routes (e.g.
  // /notebooks/:id) resolve to index.html instead of 404ing. Skipped
  // whenever apps/web/dist hasn't been built (dev, most test runs) so
  // nothing here depends on a build step being present.
  const webDistDir = resolveWebDistDir(options.webDistDir);
  const serveWeb = existsSync(webDistDir);
  if (serveWeb) {
    app.register(fastifyStatic, { root: webDistDir });
  }

  app.setNotFoundHandler((request, reply) => {
    if (serveWeb && !request.raw.url?.startsWith('/api/')) {
      return reply.sendFile('index.html');
    }
    return reply.status(404).send({
      error: 'not_found',
      message: `Route ${request.method}:${request.raw.url} was not found`,
    });
  });

  return app;
}
