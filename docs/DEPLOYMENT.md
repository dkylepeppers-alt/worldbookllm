# Deployment

worldbookllm is a **local-first, single-process web app** (ADR 0001, ADR 0002, ADR 0010): in
production, one Node process serves both the API and the built web app on one port. There is no
database server, no accounts service, and no cloud dependency to provision — everything the app
needs lives under one data directory on the machine you run it on.

## Requirements

- Node.js ≥ 20.19 and [pnpm](https://pnpm.io) 9 (or Docker, see below — it needs neither installed
  on the host).
- A machine or container that keeps running while you use the app (a laptop, a home server, a small
  VPS). Nothing here requires always-on availability the way a multi-user SaaS would.

## Environment variables

| Variable           | Default                 | Meaning                                                                                                                                        |
| ------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `HOST`             | `127.0.0.1`             | Interface the server binds to. Set to `0.0.0.0` to accept connections from other machines/containers.                                          |
| `PORT`             | `3001`                  | Port the server (API + built web app) listens on.                                                                                              |
| `DATA_DIR`         | `<repo>/data`           | Where the SQLite database, source Markdown files, and secrets file live. **The only directory you need to back up.**                           |
| `WEB_DIST_DIR`     | `<repo>/apps/web/dist`  | The built web app the server serves. Only relevant if you build/host the web app somewhere other than its default location next to the server. |
| `API_PROXY_TARGET` | `http://127.0.0.1:3001` | **Dev only** — where `pnpm dev`'s Vite server proxies `/api`. Not used in production, where there is only one server.                          |

Every variable has a sensible default; a bare `pnpm start` after `pnpm build` works with no
configuration at all.

## Running in production without Docker

```bash
pnpm install
pnpm build      # builds packages/*, the web app (incl. PWA manifest + service worker), and the server
pnpm start      # one process, one port — apps/server serves its API and the built web app
```

By default this binds `127.0.0.1:3001` and stores data under `./data`. To run on a fixed port on all
interfaces with data kept elsewhere:

```bash
HOST=0.0.0.0 PORT=8080 DATA_DIR=/srv/worldbookllm/data pnpm start
```

Keep the process running with your process manager of choice (systemd, pm2, a `screen`/`tmux`
session, etc.) — see the systemd example below.

## Docker

A `Dockerfile` and `docker-compose.yml` are included at the repo root. They build the whole
workspace inside the image and run `pnpm start`, so the image needs nothing installed on the host
beyond Docker itself. The image favors clarity over size (a single stage, no dependency pruning);
see "Trimming the image" below if that matters for your setup.

```bash
docker compose up -d --build
```

This publishes port 3001 and persists `DATA_DIR` in a named Docker volume (`worldbookllm-data`), so
data survives container recreation. To use a host directory instead of a named volume, replace the
`volumes:` entry in `docker-compose.yml` with a bind mount:

```yaml
volumes:
  - ./data:/data
```

Or run it directly without compose:

```bash
docker build -t worldbookllm .
docker run -d --name worldbookllm -p 3001:3001 -v worldbookllm-data:/data worldbookllm
```

### Trimming the image

The provided `Dockerfile` is a single stage that installs every dependency (including
devDependencies) and keeps the full monorepo source in the final image — simple to read and modify,
at the cost of a larger image than a production-optimized multi-stage build would produce. If image
size matters for your deployment, a multi-stage build that runs `pnpm build` in one stage and copies
only `apps/server/dist`, `apps/web/dist`, and a pruned `node_modules` into a slim runtime stage is a
reasonable follow-up — it isn't included here to keep the documented path something you can read
top to bottom and trust.

## Reverse proxy and HTTPS

Service workers and PWA installability require either `localhost`/loopback or a secure (HTTPS)
origin — plain HTTP on a non-loopback address will not register the service worker or offer an
install prompt. If you only ever open the app on the same machine it runs on, `http://127.0.0.1:PORT`
already qualifies and needs no further setup. To reach it from another device (a phone, to actually
install it as a home-screen app), put a reverse proxy with a TLS certificate in front of it.

**Caddy** (automatic HTTPS via Let's Encrypt, simplest option if you own a domain):

```
worldbook.example.com {
    reverse_proxy 127.0.0.1:3001
}
```

**nginx** (bring your own certificate, e.g. from `certbot`):

```nginx
server {
    listen 443 ssl;
    server_name worldbook.example.com;

    ssl_certificate     /etc/letsencrypt/live/worldbook.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/worldbook.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off; # keep SSE chat streaming responsive
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

`proxy_buffering off` (nginx) matters specifically because chat responses stream over
Server-Sent Events; a buffering proxy would hold the whole response before forwarding it, defeating
the streaming UI.

## Running as a systemd service

```ini
# /etc/systemd/system/worldbookllm.service
[Unit]
Description=worldbookllm
After=network.target

[Service]
Type=simple
User=worldbookllm
WorkingDirectory=/opt/worldbookllm
Environment=HOST=127.0.0.1
Environment=PORT=3001
Environment=DATA_DIR=/var/lib/worldbookllm
ExecStart=/usr/bin/pnpm start
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Build once (`pnpm install && pnpm build`) before enabling the service, and after every upgrade:

```bash
sudo systemctl enable --now worldbookllm
sudo systemctl status worldbookllm
```

## Backups

Everything worth keeping lives under `DATA_DIR`:

```
data/
├── worldbookllm.db      # SQLite: metadata, chats, settings — a rebuildable index (ADR 0003)
├── secrets.json          # your AI provider API keys, stored locally, never sent anywhere but the provider
└── notebooks/
    └── <notebook-id>/sources/<source-id>-<slug>.md   # your actual source-of-truth Markdown
```

A plain file copy or archive of `DATA_DIR` while the process is stopped is a complete, restorable
backup. If you need to back up while the app is running, `worldbookllm.db` is a WAL-mode SQLite
database — copy `worldbookllm.db`, `worldbookllm.db-wal`, and `worldbookllm.db-shm` together, or use
`sqlite3 worldbookllm.db ".backup backup.db"` for a consistent snapshot without stopping the process.
The Markdown source files are always safe to copy directly at any time — they are never
partially written (writes are atomic, temp-file-then-rename).

## Upgrading

```bash
git pull
pnpm install
pnpm build
```

Then restart however you're running it (`systemctl restart worldbookllm`, `docker compose up -d
--build`, or re-run `pnpm start`). Database schema migrations run automatically on server startup
against `DATA_DIR`; there is nothing else to migrate manually.
