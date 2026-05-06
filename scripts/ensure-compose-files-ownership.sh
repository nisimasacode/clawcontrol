#!/bin/sh
# Ensure orchestrator can write all files in the mounted compose repo.
TARGET_PATH="${1:-${COMPOSE_REPO_MOUNT_PATH:-/compose-files}}"
TARGET_UID="${ORCHESTRATOR_UID:-1000}"
TARGET_GID="${ORCHESTRATOR_GID:-1000}"

if [ ! -d "$TARGET_PATH" ]; then
  printf '%s\n' "[compose-files-permissions] target path not found: $TARGET_PATH" >&2
  exit 1
fi

MISMATCH="$(find "$TARGET_PATH" -xdev \( ! -user "$TARGET_UID" -o ! -group "$TARGET_GID" \) -print -quit)" || {
  printf '%s\n' "[compose-files-permissions] failed to scan ownership under $TARGET_PATH" >&2
  exit 1
}
if [ -z "$MISMATCH" ]; then
  printf '%s\n' "[compose-files-permissions] ownership already ${TARGET_UID}:${TARGET_GID}"
  exit 0
fi

printf '%s\n' "[compose-files-permissions] fixing ownership to ${TARGET_UID}:${TARGET_GID} under ${TARGET_PATH}"
chown -R "${TARGET_UID}:${TARGET_GID}" "$TARGET_PATH"
printf '%s\n' "[compose-files-permissions] ownership fix complete"
