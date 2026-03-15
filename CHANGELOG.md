# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0] - 2026-03-15

### Added

- **Personal AI memory system** — 32 MCP tools across 6 modules for preferences, projects, environment, and creative features.
- **Preference learning** — `get_preferences`, `set_preference`, `suggest_preference`, `review_suggestions` tools with semantic search and confidence scoring.
- **Project registry** — `register_project`, `search_projects`, `save_pattern`, `find_patterns` for cross-project knowledge.
- **Project context** — `log_context`, `get_project_context`, `update_context` for tracking milestones, tasks, bugs, and decisions per project.
- **Troubleshooting log** — `log_issue`, `search_issues` for recording and retrieving past resolutions.
- **Environment configs** — `save_config`, `get_environment`, `export_bootstrap`, `list_environments` for storing named dev environment setups and generating bootstrap scripts.
- **Creative features** — Decision journal (`log_decision`, `search_decisions`), snippets (`save_snippet`, `search_snippets`), session continuity (`start_session`, `end_session`, `resume_session`), skill tracker (`update_skill`, `get_skills`), and people graph (`lookup_person`, `update_person`).
- **Sensitive data protection** — Server-side regex scanning for secrets (API keys, tokens, passwords, PEM keys) on all write tools with `force_store` bypass after user confirmation.
- **Modular tool architecture** — Tools organized into `tools/thoughts.ts`, `tools/preferences.ts`, `tools/projects.ts`, `tools/context.ts`, `tools/environment.ts`, `tools/creative.ts` with shared `lib/embedding.ts`, `lib/metadata.ts`, `lib/sensitive.ts`.
- **13 database tables** with pgvector embeddings, 10 RPC functions for semantic search, 32 indexes, and RLS policies.
- **Expanded validation tests** — Database test now checks all 13 schema tables, RPC functions, and RLS status.

### Changed

- Schema application and validation tests now use the **Supabase Management API** instead of psql, eliminating database password and connection string requirements.
- Wizard credentials simplified — removed `db_password` and `db_host`; only `supabase_access_token` and `project_ref` needed for database operations.
- MCP server version bumped to 2.0.0.
- Zod dependency pinned to v3.23.8 for MCP SDK compatibility.

### Removed

- Direct psql database connections (replaced by Management API).
- Database password, host, and region selection from wizard UI.
- `buildConnStr` connection string builder and DNS pooler probing logic.

## [1.0.0] - 2025-03-07

### Added

- Web installer for open-brain-wizard (Supabase, Slack capture, MCP server).
- Docker image with Supabase CLI, openssl, psql, and web UI.
- CI: build and publish container on version tags; GitLab release from CHANGELOG.
