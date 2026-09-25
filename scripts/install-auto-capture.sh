#!/bin/zsh
# Install (or reinstall) the automatic closing-line capture as a macOS launchd
# agent. Runs every 15 minutes on Sunday, Monday and Thursday — the NFL's regular
# game days. The job itself decides whether anything is due, so extra runs cost
# nothing. It only fires while the Mac is awake.
#
#   zsh scripts/install-auto-capture.sh            install / update
#   zsh scripts/install-auto-capture.sh uninstall  remove
#
# To add Saturday (late-season games), add 6 to DAYS below and re-run.
set -e
LABEL="com.propedge.autocapture"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
REPO="${0:A:h:h}"
DAYS=(0 1 4)   # launchd weekdays: 0 = Sunday, 1 = Monday, 4 = Thursday

case "$REPO" in
  "$HOME/Documents"*|"$HOME/Desktop"*|"$HOME/Downloads"*)
    echo "Refusing to install: $REPO is in a folder macOS blocks background jobs from reading."
    echo "Move the repo (e.g. to ~/Code) and run this again."
    exit 1 ;;
esac

if [[ "$1" == "uninstall" ]]; then
  launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed $LABEL."
  exit 0
fi

# The repo must live outside ~/Documents, Desktop and Downloads: macOS privacy
# controls stop launchd jobs from reading those folders, and the job fails before
# it starts (exit 78). launchd does not see nvm, so node's path is recorded now;
# re-run this installer after upgrading node or moving the repo.
NODE="$(command -v node)"
NODE_BIN="$(dirname "$NODE")"

intervals=""
for d in $DAYS; do
  for m in 0 15 30 45; do
    intervals+="    <dict><key>Weekday</key><integer>$d</integer><key>Minute</key><integer>$m</integer></dict>
"
  done
done

mkdir -p "$HOME/Library/LaunchAgents" "$REPO/logs"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>--conditions=react-server</string>
    <string>--env-file=.env</string>
    <string>--import</string>
    <string>tsx</string>
    <string>src/jobs/run-auto-capture.ts</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$NODE_BIN:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>StartCalendarInterval</key>
  <array>
$intervals  </array>
  <key>StandardOutPath</key><string>$REPO/logs/auto-capture.log</string>
  <key>StandardErrorPath</key><string>$REPO/logs/auto-capture.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$PLIST"
echo "Installed $LABEL — every 15 min on days ${DAYS[*]} (0=Sun 1=Mon 4=Thu)."
echo "Log: $REPO/logs/auto-capture.log"
