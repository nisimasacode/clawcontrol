---
name: openclaw-config-editor
description: >
  Safely update OpenClaw instance configuration in openclaw.json files.
  Use this skill when the orchestrator needs to inspect or modify gateway
  settings for one or more OpenClaw agents.
homepage: https://docs.openclaw.ai/gateway/configuration
---

# OpenClaw Config Editor

This skill enables the orchestrator to update `openclaw.json` files for local
OpenClaw instances in a controlled, repeatable way.

## Reference

Always use the latest gateway configuration documentation as the source of
truth before making changes:
https://docs.openclaw.ai/gateway/configuration

## Scope

Use this skill for editing instance config files such as:

- `/compose-files/configs/<agent-name>/openclaw.json`
- `/mounted-agents/<agent-name>/.openclaw/openclaw.json` (live runtime config)

For agents that are already running or previously initialized, update the live
runtime config at `/mounted-agents/<agent-name>/.openclaw/openclaw.json`.
Changes in `/compose-files/configs/<agent-name>/openclaw.json` are seed inputs
and are typically only copied on first initialization when no live config
exists.

## Safety rules

- Read the current file before editing.
- Make the smallest valid change needed for the request.
- Preserve existing keys and formatting style where possible.
- Do not invent undocumented fields or values.
- Do not write secrets into config if they should come from environment variables.
- If a setting is unclear, check docs first and ask for clarification.

## Workflow

1. Identify target instance(s) and whether each one is already initialized/running.
2. For initialized/running agents, treat `/mounted-agents/<agent-name>/.openclaw/openclaw.json` as the source of truth and edit that file.
3. Update `/compose-files/configs/<agent-name>/openclaw.json` only when requested for seed consistency or future reprovisioning.
4. Read current `openclaw.json` for each target file before editing.
5. Validate requested fields/shape against:
   https://docs.openclaw.ai/gateway/configuration
6. Apply minimal edits.
7. Re-open and verify JSON validity and expected values.
8. After live config changes, run gateway restart in the matching container:
   - `docker exec openclaw-<agent-name> openclaw gateway restart`
9. Confirm restart command success from command output.
10. Report exactly which files were changed and which were intentionally left unchanged.

## Output checklist

Before handoff, confirm:

- [ ] Every changed field exists in the latest docs
- [ ] JSON remains valid
- [ ] Only requested instances were modified
- [ ] No secrets were hardcoded
- [ ] For running agents, live config under `/mounted-agents/.../.openclaw/openclaw.json` was updated
- [ ] Gateway restart was executed via `docker exec ... openclaw gateway restart` in the matching container
- [ ] Gateway restart command completed successfully
- [ ] Follow-up operational step (if any) is clearly stated
