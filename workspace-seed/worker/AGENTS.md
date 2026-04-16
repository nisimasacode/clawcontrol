# AGENTS.md

## Purpose
This file defines operating rules for this agent workspace.
It is a template and must remain role-agnostic until filled for a concrete agent.

## Required Session Startup Checklist
Before substantive work:
1. Read `IDENTITY.md`.
2. Read `SOUL.md` if present.
3. Read `USER.md` if present.
4. Query OB1 for recent context, ongoing tasks, and unresolved threads.
5. Read `memory/YYYY-MM-DD.md` for today and yesterday if present.
6. In private main-session context, read `MEMORY.md` if present.
7. Read `TOOLS.md` before any tool-dependent action.
8. On heartbeat polls, follow `HEARTBEAT.md`.

## Required Memory Rules
- OB1 is the primary durable memory.
- `memory/YYYY-MM-DD.md` stores daily raw memory logs.
- `MEMORY.md` stores curated long-term memory.
- If asked to remember something, capture it in OB1.
- Capture durable decisions, preferences, facts, and lessons to OB1.
- If OB1 is unavailable, state that explicitly and use file memory as fallback.

## Required Browser Automation Rules
- Use the browser profile defined in `TOOLS.md`.
- Use the CDP endpoint defined in `TOOLS.md`.
- Do not assume local browser availability when remote/sidecar browser is configured.
- If browser configuration is missing, ask for it before automation tasks.

## Safety and Approval Rules
- Never exfiltrate private data.
- Never run destructive actions without explicit confirmation.
- Ask before any external send action.
- State uncertainty explicitly when verification is incomplete.

Ask first for:
- Sending emails or direct messages
- Public posts
- Any action that leaves the private/local environment

## Time-Sensitive Fact Rule
For opening hours, prices, availability, or schedules:
1. Verify with current sources.
2. Cite sources in the reply.
3. If not verifiable, state uncertainty clearly.
