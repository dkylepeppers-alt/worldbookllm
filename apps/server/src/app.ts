import { existsSync } from 'node:fs';
import { join } from 'node:path';

import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';

import { AgentService } from './agent/agent-service.js';
import { AgentChangesetService } from './agent/changesets.js';
import { CustomAgentService } from './agent/custom-agents.js';
import { StorySkillsInstaller } from './agent/story-skills-installer.js';
import { AgentToolRegistry } from './agent/tools.js';
import { openDatabase } from './db/database.js';
import { resolveDataDir, resolveWebDistDir } from './env.js';
import { SkillFileStore } from './files/skill-files.js';
import { ProviderHttpClient } from './providers/http-client.js';
import { installErrorHandler } from './routes/helpers.js';
import { registerAgentRoutes } from './routes/agent.js';
import { registerBookRoutes } from './routes/books.js';
import { registerProviderRoutes } from './routes/providers.js';
import { registerSecretRoutes } from './routes/secrets.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerSkillRoutes } from './routes/skills.js';
import { SecretStore } from './secrets/secret-store.js';
import { BookService } from './services/books.js';
import { NotebookMigrationService } from './services/notebook-migration.js';
import { ProviderService } from './services/providers.js';
import { SettingsService } from './services/settings.js';
import { UPLOAD_LIMIT_BYTES } from './services/converters/limits.js';
import { SkillService } from './services/skills.js';
import { BookFileStore } from './story/book-files.js';
import { BookIndex } from './story/book-index.js';
import { CheckpointService } from './story/checkpoints.js';
import { StoryCli } from './story/story-cli.js';

/**
 * True for a request the SPA fallback should answer with index.html: a
 * GET/HEAD for something that isn't the API and isn't a real (missing) file.
 * Excludes other methods (a POST to an unknown path is a real 404, not a
 * page load) and excludes any path whose last segment has a file extension
 * (e.g. a missing /icons/x.png stays a 404 instead of silently becoming the
 * app shell).
 */
function isSpaNavigation(method: string, url: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  const pathname = url.split(/[?#]/u)[0] ?? url;
  if (pathname === '/api' || pathname.startsWith('/api/')) return false;
  const lastSegment = pathname.slice(pathname.lastIndexOf('/') + 1);
  return !lastSegment.includes('.');
}

interface AppServices {
  books: BookService;
  agent: AgentService;
  customAgents: CustomAgentService;
  changesets: AgentChangesetService;
  storySkills: StorySkillsInstaller;
  notebookMigration: NotebookMigrationService;
  skills: SkillService;
  secrets: SecretStore;
  providers: ProviderService;
  settings: SettingsService;
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

// Shared schemas cap JSON payloads by character count, but Fastify's body
// limit is in bytes and JSON serialization can spend up to 6 bytes per
// character (multi-byte UTF-8, \uXXXX escapes). 64 MiB keeps the common
// large payloads — 500k-character organization requests, a single
// 10 MiB-character source — from being rejected with 413 before validation
// runs; a maximal multi-source batch can still exceed it.
const JSON_BODY_LIMIT_BYTES = 64 * 1024 * 1024;

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? process.env.NODE_ENV !== 'test',
    bodyLimit: JSON_BODY_LIMIT_BYTES,
  });
  const dataDir = resolveDataDir(options.dataDir);
  const db = openDatabase(dataDir);
  const secrets = new SecretStore(dataDir);
  const providers = new ProviderService(
    secrets,
    new ProviderHttpClient(options.fetchImpl ?? globalThis.fetch),
  );
  const settings = new SettingsService(db);
  const bookFiles = new BookFileStore(dataDir);
  const books = new BookService(
    bookFiles,
    new BookIndex(db, bookFiles),
    new CheckpointService(db, bookFiles),
    new StoryCli(),
  );
  const skills = new SkillService(db, new SkillFileStore(dataDir));
  const skillsRoot = join(dataDir, 'skills');
  const customAgents = new CustomAgentService(db, skills);
  const changesets = new AgentChangesetService(db, books);
  const agent = new AgentService(
    db,
    books,
    skills,
    settings,
    providers,
    new AgentToolRegistry(skills, skillsRoot),
    changesets,
    customAgents,
    join(dataDir, 'staging'),
    (error) => app.log.error(error),
  );
  const storySkills = new StorySkillsInstaller(skills, skillsRoot);
  books.attachChatLifecycle({
    assertIdle: (book, action) => agent.assertBookIdle(book, action),
    removeForBook: (book) => agent.removeChatsForBook(book),
  });
  const notebookMigration = new NotebookMigrationService(db, books, agent, settings, dataDir);

  app.decorate('services', {
    books,
    agent,
    customAgents,
    changesets,
    storySkills,
    notebookMigration,
    skills,
    secrets,
    providers,
    settings,
  });

  // The notebook era ends at startup (ADR 0017): any notebooks left in an
  // older data directory move into books once, before requests are served.
  // A failure is logged rather than keeping the server down; the next start
  // retries the notebooks that did not move.
  app.addHook('onReady', async () => {
    try {
      const outcomes = await notebookMigration.run();
      if (outcomes.length > 0) {
        app.log.info({ outcomes }, 'moved notebooks into books');
      }
    } catch (error) {
      app.log.error(error, 'notebook migration failed');
    }
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

  registerBookRoutes(app);
  registerAgentRoutes(app);
  registerSecretRoutes(app);
  registerProviderRoutes(app);
  registerSettingsRoutes(app);
  registerSkillRoutes(app);

  // One process, one port in production (ADR 0002): serve the built web app
  // if it exists, with an SPA fallback so client-side routes (e.g.
  // /books/:slug) resolve to index.html instead of 404ing. Skipped
  // whenever apps/web/dist hasn't been built (dev, most test runs) so
  // nothing here depends on a build step being present.
  const webDistDir = resolveWebDistDir(options.webDistDir);
  const serveWeb = existsSync(webDistDir);
  if (serveWeb) {
    app.register(fastifyStatic, { root: webDistDir });
  }

  app.setNotFoundHandler((request, reply) => {
    const url = request.raw.url ?? '';
    if (serveWeb && isSpaNavigation(request.method, url)) {
      return reply.sendFile('index.html');
    }
    return reply.status(404).send({
      error: 'not_found',
      message: `Route ${request.method}:${url} was not found`,
    });
  });

  return app;
}
