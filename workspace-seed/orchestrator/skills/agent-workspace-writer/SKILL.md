---
name: agent-workspace-writer
description: >
  Write or scaffold the workspace files for a new or existing OpenClaw agent.
  Use this skill when acting as an AI orchestrator that needs to bootstrap,
  configure, or update another agent's workspace.
homepage: https://docs.openclaw.ai/concepts/agent-workspace#workspace-file-map-what-each-file-means
---

# Agent Workspace Writer

This skill enables you to act as an **AI orchestrator** and write the correct
workspace files for another OpenClaw agent — whether bootstrapping a new agent
from scratch or updating an existing one.

## Reference

The canonical workspace file map is at:
https://docs.openclaw.ai/concepts/agent-workspace#workspace-file-map-what-each-file-means

Always consult it if you need the latest definitions.

## Workspace location

Each agent has its own workspace directory. The default is:

```
~/.openclaw/workspace-<agent-name>/
```

The main agent uses `~/.openclaw/workspace/`. Confirm the exact path before
writing any files. When a new agent is created with `openclaw agents add`, the
workspace directory is set at that time.

## Canonical worker templates in this repository

When modeling a new worker agent workspace, start from:

- `/compose-files/workspace-seed/worker/AGENTS.md`
- `/compose-files/workspace-seed/worker/IDENTITY.md`
- `/compose-files/workspace-seed/worker/SOUL.md`
- `/compose-files/workspace-seed/worker/USER.md`
- `/compose-files/workspace-seed/worker/TOOLS.md`
- `/compose-files/workspace-seed/worker/HEARTBEAT.md`
- `/compose-files/workspace-seed/worker/MEMORY.md`

These files are role-agnostic scaffolds. Copy/adapt them into the target
agent workspace, then fill placeholders with factual, agent-specific details.

## Workspace file map

Write each file below only when you have the necessary information. Never
invent persona details, tools, or user facts — ask or infer them from context.

### `AGENTS.md` ← most important
- **Purpose:** Operating instructions for the agent. Loaded every session.
- **Write this when:** Always. This is the primary system prompt equivalent.
- **Contents to include:**
  - The agent's mission and role
  - Rules, priorities, and boundaries
  - **Explicit instruction that OB1 is the agent's primary durable memory**
  - **Required startup step to query OB1 before substantive responses**
  - **Fallback behavior when OB1 is unavailable (state failure explicitly, then use file memory)**
  - **Web-search rule: use `searxng` first; fall back to `web_search` (Brave API) only if Searxng is unavailable**
  - Session startup checklist (e.g. read today's memory, check HEARTBEAT.md)
  - Any workflows specific to this agent
- **Keep it under 20 000 chars** (bootstrap truncation limit).

### `SOUL.md`
- **Purpose:** Persona, tone, voice, and character boundaries. Loaded every session.
- **Write this when:** The agent needs a distinct personality or communication style.
- **Contents to include:**
  - Name, archetype, and communication style
  - What the agent is and is NOT (clear negative space)
  - Emotional register and language patterns
  - Values and non-negotiables

### `USER.md`
- **Purpose:** Who the user is and how to address them. Loaded every session.
- **Write this when:** The agent will have a consistent primary user.
- **Contents to include:**
  - User's name and preferred form of address
  - Key personal/professional context the agent needs to function
  - Communication preferences (language, formality, response length)
  - Anything the agent should always remember about the user

### `IDENTITY.md`
- **Purpose:** The agent's name, emoji, and vibe at a glance.
- **Write this when:** Bootstrapping a new agent.
- **Contents to include:**
  - Agent name (should match the `openclaw agents add` name)
  - Short tagline or one-sentence description
  - Emoji identifier (used in message headers)
  - Creation/update date

### `TOOLS.md`
- **Purpose:** Notes about locally installed tools and conventions.
  Does NOT control tool availability — it is guidance only.
- **Write this when:** The agent relies on specific CLIs, scripts, or MCP servers.
- **Contents to include:**
  - Key binaries and their purpose
  - Scripts in the workspace and how to invoke them
  - MCP servers configured for this agent
  - Environment conventions (Python venv, Node path, etc.)

### `HEARTBEAT.md`
- **Purpose:** A short checklist the agent runs on scheduled heartbeat triggers.
- **Write this when:** The agent has recurring background tasks.
- **Keep it very short** — token burn compounds on every heartbeat run.
- **Contents to include:**
  - Ordered list of checks (3–8 items max)
  - Clear "done condition" for each item
  - Any data files to read or produce

### `BOOT.md` (optional)
- **Purpose:** Startup checklist run on gateway restart (when internal hooks are enabled).
- **Write this when:** The agent needs to do something specific on every gateway boot.
- **Keep it short** — use the message tool for any outbound sends.

### `BOOTSTRAP.md` (one-time only)
- **Purpose:** First-run ritual for a brand-new workspace.
- **Write this when:** Creating a completely new agent for the first time.
- **Important:** Instruct the agent to **delete this file after the ritual is complete**.
- **Contents to include:**
  - Step-by-step onboarding tasks
  - Confirmation messages to send once done
  - Self-introduction instructions

### `memory/YYYY-MM-DD.md` (daily log)
- **Purpose:** Daily memory entries. One file per day.
- **Write this when:** Seeding initial context for a new agent, or updating today's entry.
- **Format:** Date-stamped markdown. Recommend the agent read today + yesterday on startup.
- **Path:** Always `memory/<YYYY-MM-DD>.md` inside the workspace.

### `MEMORY.md` (optional curated long-term memory)
- **Purpose:** Distilled, stable long-term facts about the user and context.
- **Write this when:** The agent accumulates enough session memory to warrant a curated summary.
- **Important:** Only load in the main, private session — not shared/group contexts.
- **Keep it under the bootstrap char limit** or split with the daily log.

### `skills/` (optional)
- **Purpose:** Agent-specific skills that override any same-named bundled skill.
- **Write this when:** The agent needs a specialized repeatable workflow.
- **Structure:** `skills/<skill-name>/SKILL.md` — one subdirectory per skill.
- **This very file** is an example of a workspace skill.

### `canvas/` (optional)
- **Purpose:** Canvas UI files (e.g. `canvas/index.html`) for node displays.
- **Write this when:** The agent drives a visual canvas interface.

## What NOT to write into the workspace

These belong under `~/.openclaw/` and must NOT be committed or written into the workspace:

- `~/.openclaw/openclaw.json` (config — edit via `openclaw configure`)
- `~/.openclaw/agents/<name>/agent/auth-profiles.json` (OAuth + API keys)
- `~/.openclaw/credentials/` (provider credentials)
- `~/.openclaw/agents/<name>/sessions/` (session transcripts)
- `~/.openclaw/skills/` (managed skills — install via `openclaw skills`)

## Orchestration workflow

When bootstrapping a new agent's workspace:

1. **Gather requirements** — Agent name, purpose, primary user, persona, tools, recurring tasks.
2. **Create the workspace directory** if it doesn't exist:
   `mkdir -p ~/.openclaw/workspace-<agent-name>`
3. **Write files in this order:**
   1. `IDENTITY.md` (establishes the agent's name and vibe)
   2. `SOUL.md` (persona and tone)
   3. `USER.md` (user context)
   4. `AGENTS.md` (operational rules — write last so you can reference the above)
   5. `TOOLS.md` (only if tools are known)
   6. `HEARTBEAT.md` (only if recurring tasks exist)
   7. `BOOTSTRAP.md` (only for brand-new agents)
4. **Register the agent** (if not done yet):
   `openclaw agents add <name> --workspace ~/.openclaw/workspace-<name>`
5. **Verify** the workspace is recognised: `openclaw agents list`
6. **Confirm** to the user which files were written and what was omitted and why.

## Updating an existing agent's workspace

1. **Read the current files** before overwriting anything.
2. **Update AGENTS.md** when rules or workflows change.
3. **Update USER.md** when the user's context or preferences change.
4. **Rotate memory** — archive old `memory/` entries, update `MEMORY.md` if curated.
5. **Never delete** `SOUL.md` or `IDENTITY.md` without explicit confirmation.

## Quality checks

Before handing off:
- [ ] All file contents are factual — no invented personas, tools, or user details
- [ ] `AGENTS.md` includes a startup checklist (what to read, what to check)
- [ ] `AGENTS.md` explicitly states OB1 is primary durable memory and includes OB1 startup/fallback behavior
- [ ] `AGENTS.md` includes a web-search rule: use `searxng` first and `web_search` only if Searxng is unavailable
- [ ] `HEARTBEAT.md` is concise (< 300 words)
- [ ] No credentials or API keys are written into workspace files
- [ ] `BOOTSTRAP.md` (if written) instructs the agent to delete it after first run
