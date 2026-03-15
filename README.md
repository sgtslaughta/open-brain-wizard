# open-brain-wizard

![open-brain-wizard logo](media/ob.png)

A personal AI memory system. Capture thoughts from Slack, learn preferences, track projects, store environment configs, and query everything by meaning from any MCP-connected AI (Claude, ChatGPT, Cursor, Copilot). One Supabase project, one MCP server, zero middleware.

## Source / Inspiration

This project expands on the concept demonstrated by **Nate B. Jones**. Watch the original video:

[![Watch Nate B. Jones' video](https://img.youtube.com/vi/2JiMmye2ezg/maxresdefault.jpg)](https://youtu.be/2JiMmye2ezg?si=cSQ0xkMosKx6k-V4)

> [Building a Second Brain with MCP, Supabase & Slack](https://youtu.be/2JiMmye2ezg?si=cSQ0xkMosKx6k-V4) — Nate B. Jones

Thank you Nate for the inspiration!

## What you build

- **Capture:** A Slack channel where you type a thought; it is embedded, classified, and stored in Supabase automatically; you get a confirmation reply.
- **Retrieval:** An MCP server (hosted on Supabase) so any AI assistant can search your brain by meaning and write to it.
- **Preferences:** Models learn your coding style, communication preferences, and workflow habits across sessions.
- **Projects:** A registry of all your repos with cross-project pattern search ("How did I handle auth before?").
- **Context:** Per-project milestones, tasks, bugs, decisions, and a troubleshooting knowledge base.
- **Environment:** Store your full dev setup and generate bootstrap scripts for new machines.
- **Creative:** Decision journal, persistent snippets, session continuity, skill tracker, and people graph.

### MCP Tools (32)

| Module | Tools | Purpose |
| --- | --- | --- |
| Thoughts | `capture_thought`, `search_thoughts`, `list_thoughts`, `thought_stats` | Capture and semantic search |
| Preferences | `get_preferences`, `set_preference`, `suggest_preference`, `review_suggestions` | Learn and recall user preferences |
| Projects | `register_project`, `search_projects`, `save_pattern`, `find_patterns` | Cross-project knowledge |
| Context | `log_context`, `get_project_context`, `update_context`, `log_issue`, `search_issues` | Project lifecycle and troubleshooting |
| Environment | `save_config`, `get_environment`, `export_bootstrap`, `list_environments` | Named dev environment management |
| Creative | `log_decision`, `search_decisions`, `save_snippet`, `search_snippets`, `start_session`, `end_session`, `resume_session`, `update_skill`, `get_skills`, `lookup_person`, `update_person` | Decisions, snippets, sessions, skills, people |

## Services

| Service    | Role                          | Cost             |
| ---------- | ----------------------------- | ---------------- |
| Supabase   | Database and Edge Functions   | Free Tier        |
| OpenRouter | Embeddings and metadata (LLM) | ~$5 lasts months |
| Slack      | Capture interface             | Free Tier        |

## Quick start

### Option A: Pre-built image (fastest)

Pull the latest image from the GitLab container registry and run:

```bash
mkdir -p open-brain-data
docker run -d --name open-brain \
  -p 8080:8080 \
  -v "$(pwd)/open-brain-data:/data" \
  -e PUID=$(id -u) -e PGID=$(id -g) \
  ghcr.io/sgtslaughta/open-brain-wizard/open-brain-installer:latest
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
  open-brain-wizard
============================================
  UID/GID: 1000:1000
  Data dir: /data
  credentials.yaml: FOUND
    supabase_access_token: SET
    project_ref: SET
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
- `supabase/functions/open-brain-mcp/` — MCP server Edge Function with modular tool architecture:
  - `index.ts` — Server setup, auth, routing.
  - `tools/` — `thoughts.ts`, `preferences.ts`, `projects.ts`, `context.ts`, `environment.ts`, `creative.ts`.
  - `lib/` — `embedding.ts`, `metadata.ts`, `sensitive.ts` (shared utilities).
- `supabase/functions/ingest-thought/` — Slack capture Edge Function.
- `sql/schema.sql` — Database schema (13 tables, 10 RPC functions, idempotent, safe to re-run).
- `credentials.yaml.template` — Copy to `credentials.yaml`, fill in, then scripts read from it.
- `.gitlab-ci.yml` — CI/CD pipeline: lint, security scan, build, and publish to GitLab container registry.

## CI/CD

The `.gitlab-ci.yml` pipeline runs on every push. Lint and security run on all pushes; build, publish, and release run only on **version tags**.

| Stage    | Job                     | Description |
| -------- | ----------------------- | ----------- |
| lint     | `lint:js`               | ESLint on server.js |
| lint     | `lint:dockerfile`       | Hadolint on Dockerfile |
| lint     | `lint:shell`            | ShellCheck on bash scripts |
| security | `security:trivy`       | Trivy filesystem scan for vulnerabilities |
| security | `security:secrets`     | TruffleHog secret detection |
| build    | `validate:version`     | Ensure tag matches `VERSION` and `docker/package.json` (tags only) |
| build    | `build`                | Docker build on git tags only |
| publish  | `publish`              | Push image as version tag and `latest` (tags only) |
| release  | `prepare:release_notes`| Extract release notes from `CHANGELOG.md` (tags only) |
| release  | `release`              | Create GitLab release with those notes (tags only) |

### Version and releasing

- **`VERSION`** — Single source of truth (e.g. `1.0.0`). Must match the git tag used for the release.
- **`CHANGELOG.md`** — [Keep a Changelog](https://keepachangelog.com/) format. The section for the tagged version is used as the GitLab release description.
- **`scripts/bump-version.sh`** — Updates `VERSION`, `docker/package.json`, and adds a new `CHANGELOG` section. Usage:
  - `./scripts/bump-version.sh 1.1.0` — set next version explicitly.
  - `./scripts/bump-version.sh patch|minor|major` — bump from current `VERSION`.
- **Releasing:** After editing `CHANGELOG` (or using `bump-version.sh`), commit, then tag and push. CI builds the image, pushes `:tag` and `:latest`, and creates the GitLab release from `CHANGELOG`:
  ```bash
  git add VERSION docker/package.json CHANGELOG.md && git commit -m "Release 1.0.0"
  git tag 1.0.0
  git push origin main && git push origin 1.0.0
  ```

## Documentation

- [Full setup guide](docs/SETUP.md) — Step-by-step Supabase, OpenRouter, Slack, and MCP setup.
- [Troubleshooting](TROUBLESHOOTING.md) — Common issues, Supabase console tips, Slack private channels.

## Credentials

Copy `credentials.yaml.template` to `credentials.yaml` and fill in the placeholders. Never commit `credentials.yaml` or `.credentials`.
