# HEARTBEAT.md

1. Check that required core services are running (`ob1-db`, `ob1-rest`, `openclaw-orchestrator`). Done when each service is healthy/up.
2. Review recent orchestrator and worker errors from logs. Done when critical errors are triaged or explicitly acknowledged.
3. Verify seeded configs and compose definitions are consistent after agent changes. Done when no unexpected drift is detected.
4. Confirm OB1 schema coverage for active agents. Done when each active agent has its expected schema.
5. Record outcomes and follow-ups in today’s memory file. Done when memory entry includes status and next actions.
