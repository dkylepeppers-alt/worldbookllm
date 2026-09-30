import { buildApp } from './app.js';

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '127.0.0.1';

const app = buildApp();

// Close cleanly on stop (docker stop, systemd, Ctrl+C) so SQLite is closed
// rather than killed mid-write. Node as a container's PID 1 would otherwise
// ignore SIGTERM entirely.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    app.close().then(
      () => process.exit(0),
      (err: unknown) => {
        app.log.error(err);
        process.exit(1);
      },
    );
  });
}

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
