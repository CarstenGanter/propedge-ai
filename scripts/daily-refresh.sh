#!/bin/zsh
# PropEdge AI — daily refresh wrapper for cron / launchd.
# Fetches props from The Odds API for your enabled sports and generates picks.
# Runs standalone against the local SQLite DB — the web app does NOT need to be open.

# Load nvm so `node` resolves even in cron's minimal environment.
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" >/dev/null 2>&1

# The project is the folder above this script, resolved through any symlink,
# so moving the repo never breaks the job. Keep it out of ~/Documents, Desktop
# and Downloads: macOS stops background jobs from reading those folders.
PROJECT_DIR="${0:A:h:h}"
cd "$PROJECT_DIR" || exit 1

echo "----- $(date) -----" >> daily-refresh.log
node --conditions=react-server --env-file=.env --import tsx src/jobs/run-daily.ts >> daily-refresh.log 2>&1
