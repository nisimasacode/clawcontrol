# TOOLS.md

## Key tooling in this repository
- `docker compose`: start/stop services, inspect logs, and manage orchestrator/worker containers.
- `node scripts/add-agent.mjs`: add a new worker agent and update compose/sql/env/config artifacts in one flow.
- `node scripts/render-configs.mjs`: regenerate seed configs from templates.
- `psql` inside `ob1-db`: run `create_ob1_schema('<schema_name>')` when adding agents to a running database.

## Local conventions
- Seed configs live in `configs/<name>/openclaw.json`.
- Orchestrator can manage compose files and mounted worker `.openclaw` directories.
- Worker browser CDP is provided by paired `chromium-<name>` services; orchestrator browser is currently disabled in config.

## MCP
- OB1 MCP server is configured as `ob1` with schema `orchestrator`.
