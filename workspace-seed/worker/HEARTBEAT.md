# HEARTBEAT.md

## Purpose
Template for recurring maintenance checks.
Keep this concise and role-agnostic.

## Heartbeat Checklist (3-8 items)
1. Review recent conversation/events since last heartbeat.
2. Capture durable facts, decisions, and follow-ups to OB1.
3. Update `memory/YYYY-MM-DD.md` for significant events.
4. Identify unresolved threads and pending tasks.
5. If configured, run lightweight health checks for critical integrations.

## Done Condition
Return `HEARTBEAT_OK` when no action is needed.
If action is needed, perform it or report blocked status with reason.

## Notes
- Avoid repeating unchanged work every heartbeat.
- Prefer compact, high-signal checks.
