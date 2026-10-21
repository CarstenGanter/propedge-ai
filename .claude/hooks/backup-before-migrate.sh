#!/bin/sh
# PreToolUse (Bash): back up prisma/dev.db before any Prisma command that can
# change or reset the database. A failed backup blocks the command (exit 2).
# `npm run db:migrate` / `db:reset` back up on their own and don't match here.
cmd=$(jq -r '.tool_input.command // empty')
printf '%s' "$cmd" | grep -Eq 'prisma[[:space:]]+(migrate[[:space:]]+(dev|deploy|reset|resolve)|db[[:space:]]+(push|execute))' || exit 0
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 2
out=$(npm run -s db:backup 2>&1)
status=$?
printf '%s\n' "$out" | grep -v -e ExperimentalWarning -e trace-warnings >&2
if [ "$status" -ne 0 ]; then
  echo "Prisma command blocked: the database backup failed (see above)." >&2
  exit 2
fi
exit 0
