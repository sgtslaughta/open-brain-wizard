# open-brain-wizard

![open-brain-wizard logo](media/ob.png)

One database, one AI gateway, one chat channel. Capture thoughts from Slack and query them by meaning from any MCP-connected AI (Claude, ChatGPT, Cursor, etc.). No middleware, no SaaS chains.

## Source / Inspiration

This project expands on the concept demonstrated by **Nate B. Jones**. Watch the original video:

[![Watch Nate B. Jones' video](https://img.youtube.com/vi/2JiMmye2ezg/maxresdefault.jpg)](https://youtu.be/2JiMmye2ezg?si=cSQ0xkMosKx6k-V4)

> [Building a Second Brain with MCP, Supabase & Slack](https://youtu.be/2JiMmye2ezg?si=cSQ0xkMosKx6k-V4) — Nate B. Jones

Thank you Nate for the inspiration!

## What you build

- **Capture:** A Slack channel where you type a thought; it is embedded, classified, and stored in Supabase automatically; you get a confirmation reply.
- **Retrieval:** An MCP server (hosted on Supabase) so any AI assistant can search your brain by meaning and write to it.

## Services (free tier)

| Service    | Role                          |
| ---------- | ----------------------------- |
| Supabase   | Database and Edge Functions   |
| OpenRouter | Embeddings and metadata (LLM) |
| Slack      | Capture interface             |

## Quick start

### Option A: Pre-built image (fastest)

Pull the latest image from the GitLab container registry and run:

```bash
mkdir -p open-brain-data
docker run -d --name open-brain \
  -p 8080:8080 \
  -v "$(pwd)/open-brain-data:/data" \
  -e PUID=$(id -u) -e PGID=$(id -g) \
  registry.gitlab.com/richardsoto1010/open-brain-wizard:latest
```

Open [http://localhost:8080](http://localhost:8080) and follow the wizard.

### Option B: Build locally

```bash
# Clone the repo
git clone <your-repo-url> && cd open-brain-dist

# Build
docker build -f docker/Dockerfile -t open-brain-installer .

# Run
mkdir -p open-brain-data
docker run -d --name open-brain \
  -p 8080:8080 \
  -v "$(pwd)/open-brain-data:/data" \
  -e PUID=$(id -u) -e PGID=$(id -g) \
  open-brain-installer
```

Open [http://localhost:8080](http://localhost:8080) and follow the wizard.

### Docker options

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `PUID`   | `1000`  | User ID for file ownership in `/data` |
| `PGID`   | `1000`  | Group ID for file ownership in `/data` |
| `PORT`   | `8080`  | Web UI port |
| `SUPABASE_ACCESS_TOKEN` | — | Optional: pass via env instead of the wizard |

The container logs credential status at startup:

```
============================================
  Open Brain Installer
============================================
  UID/GID: 1000:1000
  Data dir: /data
  credentials.yaml: FOUND
    supabase_access_token: SET
    project_ref: SET
    db_password: ---
    openrouter_api_key: SET
    slack_bot_token: SET
    slack_capture_channel: SET
    mcp_access_key: SET
  Port: 8080
============================================
```

### Option C: Scripts (Windows / Linux / Mac)

1. **Clone or copy this repo.** Copy `credentials.yaml.template` to `credentials.yaml` and fill in the placeholders (scripts read from this file). Never commit `credentials.yaml` or `.credentials`.
2. **Install prerequisites:**
   - Windows: `.\scripts\install.ps1`
   - Linux / Mac: `./scripts/install.sh`
3. **Follow the full setup:** [docs/SETUP.md](docs/SETUP.md) (Supabase project, database schema, Slack app, Edge Functions, MCP).
4. **Link, set secrets, and deploy:**
   - `.\scripts\link.ps1` or `./scripts/link.sh`
   - `.\scripts\set-secrets.ps1` or `./scripts/set-secrets.sh`
   - `.\scripts\deploy.ps1` or `./scripts/deploy.sh`
5. **Verify:** `.\scripts\doctor.ps1` or `./scripts/doctor.sh`

## Project layout

- `docker/` — Dockerfile, entrypoint, and web installer (Node server + wizard UI).
- `scripts/` — Install, link, set-secrets, deploy, and doctor scripts for Windows (PowerShell) and Linux/Mac (Bash).
- `supabase/functions/` — Edge Functions: `ingest-thought` (Slack -> DB) and `open-brain-mcp` (MCP server).
- `sql/schema.sql` — Database schema (idempotent, safe to re-run).
- `credentials.yaml.template` — Copy to `credentials.yaml`, fill in, then scripts read from it.
- `.gitlab-ci.yml` — CI/CD pipeline: lint, security scan, build, and publish to GitLab container registry.

## CI/CD

The `.gitlab-ci.yml` pipeline runs on every push:

| Stage    | Job               | Description |
| -------- | ----------------- | ----------- |
| lint     | `lint:js`         | ESLint on server.js |
| lint     | `lint:dockerfile` | Hadolint on Dockerfile |
| lint     | `lint:shell`      | ShellCheck on bash scripts |
| security | `security:trivy`  | Trivy filesystem scan for vulnerabilities |
| security | `security:secrets`| TruffleHog secret detection |
| build    | `build`           | Docker build and artifact |
| publish  | `publish:latest`  | Push `latest` tag on default branch |
| publish  | `publish:tag`     | Push version tag on git tags |

## Documentation

- [Full setup guide](docs/SETUP.md) — Step-by-step Supabase, OpenRouter, Slack, and MCP setup.
- [Troubleshooting](TROUBLESHOOTING.md) — Common issues, Supabase console tips, Slack private channels.

## Credentials

Copy `credentials.yaml.template` to `credentials.yaml` and fill in the placeholders. Never commit `credentials.yaml` or `.credentials`.
