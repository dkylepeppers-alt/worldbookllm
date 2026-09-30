# Production image: build the pnpm workspace in one stage, then run only the
# server bundle, its production dependencies, and the built web app, which the
# server serves itself (ADR 0002, ADR 0010).

FROM node:24-slim AS build

# better-sqlite3 needs a native addon; these let it build from source on any
# platform it has no prebuilt binary for. They stay in this stage.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN corepack enable

# Manifests first, so the dependency layer is reused until one of them changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/e2e/package.json apps/e2e/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/providers/package.json packages/providers/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# The server with only its production dependencies. The workspace packages it
# imports are already bundled into dist/ by esbuild.
RUN pnpm deploy --filter @worldbookllm/server --prod --legacy /out/server

FROM node:24-slim

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001
ENV DATA_DIR=/data

WORKDIR /app
# Same layout as the repo, so the server finds apps/web/dist by default.
COPY --from=build /out/server apps/server
COPY --from=build /app/apps/web/dist apps/web/dist

# Run as the image's unprivileged node user (uid 1000), who owns the data dir.
RUN mkdir /data && chown node:node /data
USER node

VOLUME ["/data"]
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/api/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# node as PID 1 (not pnpm), so `docker stop` signals reach the server.
CMD ["node", "apps/server/dist/index.js"]
