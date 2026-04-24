# ClawControl

`ClawControl` is a Docker Compose-based multi-agent runtime for OpenClaw. It runs one orchestrator agent and multiple worker agents, all sharing a single OB1 (Open Brain) PostgreSQL + pgvector memory backend.

The database memory layer in this stack is based on OB1:
- https://github.com/NateBJones-Projects/OB1

This repository is designed so you can:
- bring up a complete local/hosted agent fleet quickly
- add/remove worker agents with predictable conventions
- keep agent memory isolated per agent while still centrally managed
- coordinate deployment and runtime operations through one orchestrator

## What runs in this stack

At a high level, the stack includes:

- `ob1-db`: PostgreSQL 16 + pgvector, the shared durable memory store
- `ob1-rest`: PostgREST API layer over OB1 schemas
- `searxng`: internal web search service used by agents
- `openclaw-orchestrator`: control-plane agent for fleet management
- `openclaw-agentN`: worker agents
- `chromium-agentN`: per-worker browser sidecar containers (for CDP browser automation)

Each worker gets:
- its own OpenClaw service
- its own Chromium sidecar (if browser-enabled)
- its own OB1 schema (logical memory isolation)
- its own host-mounted config/workspace directories

## Architecture and orchestration model

## 1) Control plane vs data plane

- Control plane: `openclaw-orchestrator`
  - can edit compose files and seeded configs
  - has read/write mounts to worker `.openclaw` directories
  - can execute Docker Compose operations through Docker socket mount
- Data plane: worker agents (`openclaw-agent1`, `openclaw-agent2`, ...)
  - each serves an OpenClaw gateway endpoint
  - each can use browser automation via its dedicated Chromium sidecar

## 2) Shared memory with per-agent isolation

OB1 uses one PostgreSQL instance with separate schemas:
- `orchestrator`
- `agent1`, `agent2`, etc.
- `public` (shared/default)

Schema provisioning is handled by `create_ob1_schema(schema_name)` in `ob1/init.sql`.
Each schema gets:
- `thoughts` table with `vector(1536)` embeddings
- vector index for semantic search
- metadata indexes
- update triggers
- helper functions:
  - `match_thoughts(...)`
  - `upsert_thought(...)`

## 3) Seeded config pattern

For each agent container startup:
- if `~/.openclaw/openclaw.json` does not exist, it is copied from `/seed/openclaw.json`
- if it already exists, it is left unchanged

This means:
- `configs/<agent>/openclaw.json` is the initial seed
- runtime config eventually lives in host-mounted volume under `${DATA_ROOT}`

## 4) Port conventions

Defaults follow deterministic patterns:
- gateway ports are odd numbers: orchestrator starts at `18789`, each new worker increments by `+2`
- bridge port = gateway port + 1
- chromium UI ports start at `3002` and increment
- OB1 REST defaults to `3100`
- OB1 MCP defaults to `3101`
- OB1 PostgreSQL host exposure defaults to `5433`

## Why this setup fixes common OpenClaw pain points

A lot of OpenClaw deployments run into two recurring classes of issues: memory reliability and browser automation instability. This stack is opinionated specifically to reduce both.

### Common memory issues this solves

- per-agent schema isolation (`orchestrator`, `agent1`, `agent2`, etc.) to prevent cross-agent memory bleed
- deterministic OB1 initialization via `ob1/init.sql`, including `create_ob1_schema(...)`
- semantic retrieval function (`match_thoughts`) and vector indexing built into each schema
- deduplicating upsert path (`upsert_thought`) using content fingerprints
- scripted agent expansion (`scripts/add-agent.mjs`) that updates compose + SQL + env + config together to avoid partial/manual drift

### Common browser automation issues this solves

Typical problems in ad-hoc setups:
- multiple agents contending for one browser instance/profile
- browser config drift between agent definitions
- automation breakage after restarts or host moves

How `ClawControl` addresses them:
- dedicated Chromium sidecar per worker (`chromium-agentN`) for strict isolation
- fixed internal CDP target per agent (`http://chromium-<name>:9223`)
- deterministic port allocation conventions for gateway/bridge/chromium UI
- browser/no-browser template split (`openclaw.worker.json` vs `openclaw.worker.nobrowser.json`) for explicit capability control
- persistent host-mounted browser config and agent workspace paths under `${DATA_ROOT}`

### Security improvements over typical multi-agent OpenClaw setups

This design improves security posture by isolating each agent into its own service containers, rather than sharing one runtime/browser process across many agents.

Key security benefits:
- per-agent process/container isolation reduces blast radius if one worker is compromised or misconfigured
- per-agent browser sidecars reduce cross-agent session/cookie/token leakage risk
- per-agent gateway tokens support independent credential rotation and revocation
- per-agent OB1 schemas reduce accidental cross-agent memory disclosure
- orchestrator/worker role separation keeps high-privilege orchestration concerns out of worker containers

This is still a shared Docker network, so isolation is not equivalent to separate hosts or separate clusters, but it is materially safer than tightly shared single-container multi-agent patterns.

## Prerequisites

- Docker Engine with Compose v2 (`docker compose`)
- Linux host recommended
- Node.js 18+ (for local helper scripts)
- Writable storage path for `${DATA_ROOT}`

## Getting started

## 1) Clone and enter repo

```bash
git clone <your-repo-url>
cd <repo-directory>
```

## 2) Create environment file

```bash
cp .env.example .env
```

Then edit `.env` and set at minimum:
- `POSTGRES_PASSWORD`
- `PGRST_JWT_SECRET`
- `DATA_ROOT`
- gateway tokens (`ORCHESTRATOR_GATEWAY_TOKEN`, `AGENT1_GATEWAY_TOKEN`, `AGENT2_GATEWAY_TOKEN`)
- at least one model provider key (`OPENAI_API_KEY` or `ANTHROPIC_API_KEY`)
- `OPENROUTER_API_KEY` for memory embedding/search configuration

Generate token-style secrets with:

```bash
openssl rand -hex 32
```

## 3) Bring up stack

```bash
docker compose up -d
```

## 4) Verify health

```bash
docker compose ps
docker compose logs -f ob1-db
```

Agent health endpoint pattern:
- orchestrator: `http://<host>:${ORCHESTRATOR_GATEWAY_PORT}/healthz`
- worker: `http://<host>:${AGENTX_GATEWAY_PORT}/healthz`

## Environment variables guide

Important variables from `.env.example`:

- Core DB
  - `POSTGRES_USER`
  - `POSTGRES_PASSWORD`
  - `POSTGRES_DB`
  - `OB1_DB_PORT`
- PostgREST
  - `PGRST_JWT_SECRET`
  - `OB1_REST_PORT`
- OB1 MCP
  - `OB1_MCP_PORT`
  - `OB1_MCP_ACCESS_KEY`
  - `OB1_EMBEDDING_API_BASE`
  - `OB1_EMBEDDING_API_KEY`
  - `OB1_EMBEDDING_MODEL`
- Fleet/runtime
  - `DATA_ROOT`
  - `TZ`
- Model providers
  - `OPENAI_API_KEY`
  - `ANTHROPIC_API_KEY`
  - `OPENROUTER_API_KEY`
- Per-agent gateway/bridge/browser ports and tokens
  - `ORCHESTRATOR_*`
  - `AGENT1_*`
  - `AGENT2_*`

## Deployment workflow

## Initial deployment

1. Configure `.env`
2. Start full stack with `docker compose up -d`
3. Confirm all containers healthy
4. Connect clients to gateway ports

## Updating deployment

If you update compose, templates, or configs:

```bash
docker compose pull
docker compose up -d
```

For production or long-running environments, you can pin OpenClaw and Chromium image versions (instead of using moving tags like `latest`) in `docker-compose.yml`. Version pinning helps prevent unexpected OpenClaw updates from breaking behavior, including browser automations.

If you changed template-based seed configs for many agents:

```bash
node scripts/render-configs.mjs
```

Then restart affected agent containers to apply only where needed.

## Adding a new worker agent

Use the automation script:

```bash
node scripts/add-agent.mjs --name <agent-name>
```

Optional browser disable:

```bash
node scripts/add-agent.mjs --name <agent-name> --browser false
```

`add-agent.mjs` performs coordinated changes across repository state:
- updates `docker-compose.yml`
  - adds `openclaw-<name>` service
  - adds `chromium-<name>` service if browser enabled
  - adds orchestrator mount for new agent config
  - appends new schema to PostgREST schema list
- renders `configs/<name>/openclaw.json` from template
- updates `ob1/init.sql` with schema creation/grants
- appends new env variables to `.env.example` and `.env` (if present)

If OB1 is already running, create schema live:

```bash
docker exec ob1-db psql -U ob1 -d openbrain -c "SELECT create_ob1_schema('<schema_name>');"
```

Start only new services:

```bash
docker compose up -d openclaw-<name> chromium-<name>
```

## Agent orchestration details

## Orchestrator responsibilities

The orchestrator (`openclaw-orchestrator`) is the fleet manager.

Its mounts grant the ability to orchestrate:
- worker config access: `/mounted-agents/<name>/.openclaw`
- repository/compose access: `/compose-files`
- Docker control path: `/var/run/docker.sock` (read-only mount)

With this setup, orchestrator can:
- inspect and coordinate worker state
- update seeded/runtime config files
- trigger compose workflows
- manage fleet expansion using script-driven workflows

### Orchestrator skills

The orchestrator workspace includes reusable skills under `workspace-seed/orchestrator/skills`:
- `agent-workspace-writer`: scaffolds and updates agent workspace files (`AGENTS.md`, `SOUL.md`, `USER.md`, `IDENTITY.md`, `TOOLS.md`, `HEARTBEAT.md`, memory files)
- `openclaw-config-editor`: safely edits OpenClaw `openclaw.json` gateway configuration for seed and live runtime configs

## Worker responsibilities

Workers are execution nodes:
- expose gateway endpoints
- perform user/agent tasks
- use OB1 for durable memory through schema-specific MCP routes
- optionally automate browser tasks through sidecar CDP endpoint (`chromium-<name>:9223`)

## Workspace seeding and persistence

Persistent host data lives under `${DATA_ROOT}`.

Per agent, main paths are:
- `${DATA_ROOT}/openclaw-<name>/.openclaw`
- `${DATA_ROOT}/openclaw-<name>/workspace`

Orchestrator has first-start workspace bootstrap behavior:
- if orchestrator workspace is empty and `workspace-seed/orchestrator` exists
- seed files are copied into orchestrator workspace

Seed directories in repo:
- `workspace-seed/orchestrator/`
- `workspace-seed/worker/`

These contain identity/persona/memory/operational templates for consistent agent behavior.

## Config rendering model

Template files:
- `templates/openclaw.orchestrator.json`
- `templates/openclaw.worker.json`
- `templates/openclaw.worker.nobrowser.json`

Bulk render utility:

```bash
node scripts/render-configs.mjs
```

This script discovers all `openclaw-*` services from `docker-compose.yml` and re-renders `configs/<name>/openclaw.json` for each.

Use cases:
- template updates across all agents
- recovering consistent config seeds
- regenerating orchestrator and worker seed configs after manual drift

## Operations and day-2 commands

Start all services:

```bash
docker compose up -d
```

Stop all services:

```bash
docker compose down
```

Restart one service:

```bash
docker compose restart openclaw-agent1
```

Tail logs:

```bash
docker compose logs -f openclaw-orchestrator
docker compose logs -f openclaw-agent1
docker compose logs -f chromium-agent1
docker compose logs -f ob1-db
docker compose logs -f ob1-rest
```

Check running containers:

```bash
docker compose ps
```

## Troubleshooting

## Container starts but agent not using expected config

Cause:
- seed config copied only on first run when target config is absent

Fix:
- update live config under `${DATA_ROOT}/openclaw-<name>/.openclaw/openclaw.json`
- restart affected service

## New worker added but cannot query memory

Check:
- schema exists in DB (`create_ob1_schema('<schema>')` applied)
- schema is listed in `PGRST_DB_SCHEMAS`
- worker config MCP URL schema parameter matches expected agent schema

## Browser automation not working

Check:
- worker is browser-enabled template
- chromium sidecar is running
- worker `BROWSER_CDP_URL` points to `http://chromium-<name>:9223`
- relevant ports are not blocked/conflicted

## PostgREST auth/access issues

Check:
- `PGRST_JWT_SECRET` set and consistent
- DB is healthy and reachable from `ob1-rest`
- grants exist for target schemas in `ob1/init.sql`

## Security notes

- Treat all tokens and API keys in `.env` as secrets
- Never commit populated `.env` files
- Rotate gateway tokens and provider keys regularly
- Restrict host-level exposure of gateway ports where possible
- Limit who can access Docker socket on host

## Repository layout

- `docker-compose.yml`: canonical service topology
- `.env.example`: environment variable template
- `ob1/init.sql`: OB1 schema/function/grant initialization
- `ob1/mcp-server/`: OB1 MCP server implementation
- `scripts/add-agent.mjs`: add worker agent with coordinated file updates
- `scripts/render-configs.mjs`: regenerate seed configs from templates
- `templates/`: orchestrator/worker config templates
- `configs/`: per-agent rendered seed configs
- `workspace-seed/`: initial workspace scaffolding for orchestrator/workers

## Recommended workflow summary

1. Configure `.env`
2. `docker compose up -d`
3. verify health/logs
4. use `add-agent.mjs` for fleet expansion
5. use `render-configs.mjs` after template changes
6. keep runtime config/workspaces under `${DATA_ROOT}` backed up
7. avoid manual drift in compose/configs when scripted workflow exists
