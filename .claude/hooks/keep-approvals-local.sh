#!/bin/sh
# ConfigChange (project_settings) and SessionStart: move permission approvals
# out of the committed .claude/settings.json into the gitignored
# .claude/settings.local.json. The VS Code approval card can save a "don't ask
# again" approval to the project's shared file; approvals belong to this
# machine. Only permissions.allow moves — deny/ask rules stay where they are.
# Never blocks: a failure is reported on stderr and the change goes ahead.
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
node -e '
const fs = require("fs");
const shared = ".claude/settings.json";
const local = ".claude/settings.local.json";
const s = JSON.parse(fs.readFileSync(shared, "utf8"));
const allow = s.permissions?.allow ?? [];
if (allow.length === 0) process.exit(0);
const l = fs.existsSync(local) ? JSON.parse(fs.readFileSync(local, "utf8")) : {};
l.permissions = l.permissions ?? {};
l.permissions.allow = [...new Set([...(l.permissions.allow ?? []), ...allow])];
fs.writeFileSync(local, JSON.stringify(l, null, 2) + "\n");
delete s.permissions.allow;
if (Object.keys(s.permissions).length === 0) delete s.permissions;
fs.writeFileSync(shared, JSON.stringify(s, null, 2) + "\n");
console.error(`keep-approvals-local: moved ${allow.length} approval(s) from ${shared} to ${local}`);
' || echo "keep-approvals-local: could not move approvals out of .claude/settings.json" >&2
exit 0
