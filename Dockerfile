# A single, simple production image: build the whole pnpm workspace, then run
# the server, which serves both the API and the built web app (ADR 0002,
# ADR 0010). This is optimized for clarity over image size — see
# docs/DEPLOYMENT.md for a note on trimming it further.
FROM node:22-slim

# better-sqlite3 needs a native addon; these let it build from source on any
# platform pnpm doesn't have a prebuilt binary for.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN corepack enable

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001
ENV DATA_DIR=/data

VOLUME ["/data"]
EXPOSE 3001

CMD ["pnpm", "start"]
