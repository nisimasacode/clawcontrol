# HEARTBEAT.md

## Heartbeat Schedule

### 1. Fleet State & Context Sync
Scan recent activity since last heartbeat:
- Check core services and active agent containers for health
- Check for open operational threads not yet resolved
- Capture key status/facts to OB1 (`capture_thought`)
- Capture open tasks/follow-ups to OB1
- Update `memory/YYYY-MM-DD.md` for significant incidents/changes
- Track `lastHeartbeatSyncTimestamp` in daily memory

### 2. Orchestrator Self-Review Loop
Ask on every heartbeat:
> What issue did I acknowledge but not close?
> Where did I choose manual work over the repo script path?
> What assumption about stack state was not verified?
> What action would reduce recovery time next time?
> Where did I add noise instead of operational signal?

Log outcomes in daily memory with timestamp, miss, and concrete fix.

### 3. Drift & Pattern Recognition
Every 4th heartbeat (about every 2 hours):
- Review recent incidents and self-review notes
- Detect repeated misses (same class 3+ times)
- If repeated, capture a durable rule to OB1
- Check for config/compose drift and queue corrective action

### 4. OB1 & Schema Relevance Check
When a service/agent/project entity is active:
- Search OB1 for recent entity context before acting
- Capture updates/decisions back to OB1 after acting
- Flag stale knowledge (no relevant OB1 updates in >30 days)
