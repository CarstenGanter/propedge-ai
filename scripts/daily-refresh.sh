#!/bin/zsh
# PropEdge AI — daily refresh wrapper for cron / launchd.
# Fetches props from The Odds API for your enabled sports and generates picks.
# Runs standalone against the local SQLite DB — the web app does NOT need to be open.

# Load nvm so `node` resolves even in cron's minimal environment.
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" >/dev/null 2>&1

# Absolute path to the project (edit if you move it).
PROJECT_DIR="/Users/carstenganter/Documents/For Fucks/Vibe Code/propedge-ai"
cd "$PROJECT_DIR" || exit 1

echo "----- $(date) -----" >> daily-refresh.log
node --conditions=react-server --env-file=.env --import tsx src/jobs/run-daily.ts >> daily-refresh.log 2>&1
