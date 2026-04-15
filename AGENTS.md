# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## What this repo is

`agent-orc` is a Docker Compose stack that runs a fleet of **OpenClaw** AI agents sharing a single **OB1** (Open Brain) PostgreSQL+pgvector memory database. The topology is:

- **ob1-db** — PostgreSQL 16 + pgvector; the shared vector memory store
- **ob1-rest** — PostgREST; REST API over the OB1 database
- **openclaw-orchestrator** — the managing agent; no browser, has Docker socket + read/write access to all other agents' configs and the compose stack
- **openclaw-agentN + chromium-agentN** — worker agents; each has a dedicated Chromium sidecar for browser automation via CDP

## Setup

```bash
cp .env.example .env   # fill in POSTGRES_PASSWORD, PGRST_JWT_SECRET, DATA_ROOT, gateway tokens, and at least one model API key
docker compose up -d
```

## Common commands

Start the full stack:
```bash
docker compose up -d
```

Add a new worker agent (updates `docker-compose.yml`, `ob1/init.sql`, `.env.example`, and creates `configs/<name>/openclaw.json`):
```bash
node scripts/add-agent.mjs --name <agent-name>
```

After adding an agent to a running stack, create its DB schema and start its containers:
```bash
docker exec ob1-db psql -U ob1 -d openbrain -c "SELECT create_ob1_schema('<schema_name>');"
docker compose up -d openclaw-<name> chromium-<name>
```

Re-render all seed configs from templates (e.g. after changing a template):
```bash
node scripts/render-configs.mjs
```

Tail logs for a specific container:
```bash
docker compose logs -f openclaw-<name>
```

## Architecture

### OB1 memory database

Each agent gets its own PostgreSQL schema (named after it, with `-` replaced by `_`). The `create_ob1_schema()` function provisions each schema with:
- `thoughts` table — text + `vector(1536)` embedding + `metadata` JSONB + `content_fingerprint` for deduplication
- `match_thoughts(query_embedding, threshold, count, filter)` — cosine-similarity semantic search via HNSW index
- `upsert_thought(content, payload)` — insert-or-update with SHA-256 fingerprint deduplication

PostgREST exposes all agent schemas via REST at `OB1_REST_PORT` (default 3100). When a new agent is added, its schema must be added to `PGRST_DB_SCHEMAS` in `docker-compose.yml` (done automatically by `add-agent.mjs`).

### Seed config pattern

Each agent container copies `configs/<name>/openclaw.json` to `~/.openclaw/openclaw.json` only if no config already exists (first start). Subsequent config changes must be made either by editing the live volume or by rebuilding. Worker configs point their browser to `chromium-<name>:9223`.

### Orchestrator special access

The orchestrator container has:
- All worker `.openclaw` dirs mounted at `/mounted-agents/<name>/.openclaw` (read/write)
- The repo root mounted at `/compose-files`
- `/var/run/docker.sock` (read-only) for running `docker compose` commands

### Port scheme

Gateway ports use odd numbers (`18789` orchestrator, `+2` per agent). Bridge = gateway + 1. Chromium UI ports start at `3002`. `add-agent.mjs` auto-detects the next free ports by scanning the existing compose file.

### Scripts

Both scripts in `scripts/` are zero-dependency Node.js (18+) ES modules that operate entirely on local files; they do not call any Docker API.

- `add-agent.mjs` — the single source of truth for adding an agent; edits compose, SQL, env, and renders the config in one pass
- `render-configs.mjs` — discovers all agents from compose and re-renders their seed configs from `templates/`

### Skills

`skills/agent-workspace-writer/SKILL.md` is a Warp skill that describes how to bootstrap and update OpenClaw agent workspace files (`AGENTS.md`, `SOUL.md`, `USER.md`, `IDENTITY.md`, etc.). Load it when scaffolding a new agent's workspace.

## Key files to understand first

- `docker-compose.yml` — authoritative definition of all services, volumes, ports, and environment wiring
- `.env.example` — all configurable variables with their defaults and comments
- `ob1/init.sql` — full OB1 schema setup; `create_ob1_schema()` is the function to call when adding agents to a running DB
- `scripts/add-agent.mjs` — single entrypoint for adding agents; read this before manually editing compose
- `templates/openclaw.worker.json` — the canonical worker config template; `{{AGENT_NAME}}` is the only variable
