import Fastify, { type FastifyInstance } from 'fastify';

import { openDatabase } from './db/database.js';
import { resolveDataDir } from './env.js';
import { SourceFileStore } from './files/source-files.js';
import { ProviderHttpClient } from './providers/http-client.js';
import { installErrorHandler } from './routes/helpers.js';
import { registerNotebookRoutes } from './routes/notebooks.js';
import { registerProviderRoutes } from './routes/providers.js';
import { registerSecretRoutes } from './routes/secrets.js';
import { registerSourceRoutes } from './routes/sources.js';
import { SecretStore } from './secrets/secret-store.js';
import { NotebookService } from './services/notebooks.js';
import { ProviderService } from './services/providers.js';
import { SourceService } from './services/sources.js';

export interface AppServices {
  notebooks: NotebookService;
  sources: SourceService;
  secrets: SecretStore;
  providers: ProviderService;
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

  app.decorate('services', {
    notebooks: new NotebookService(db, sourceFiles),
    sources: new SourceService(db, sourceFiles),
    secrets,
    providers,
  });

  app.addHook('onClose', () => {
    if (db.open) db.close();
  });

  installErrorHandler(app);

  app.get('/api/health', () => ({ status: 'ok' }));

  registerNotebookRoutes(app);
  registerSourceRoutes(app);
  registerSecretRoutes(app);
  registerProviderRoutes(app);

  return app;
}
