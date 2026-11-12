#!/usr/bin/env bash
# Read-only: is the 8081 dev server worth driving for this worktree?
set -euo pipefail

port="${PORT:-8081}"
root="$(cd "$(dirname "$0")/../../../.." && pwd -P)"

pid="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"
if [[ -z "$pid" ]]; then
  echo "FAIL: nothing listens on port $port. Start: (cd $root && yarn web:serve --port $port)"
  exit 1
fi

cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | tail -1)"
cwd_real="$(cd "$cwd" 2>/dev/null && pwd -P || echo "$cwd")"
if [[ "$cwd_real" != "$root" ]]; then
  echo "FAIL: port $port is served from $cwd_real, not this worktree $root. Your edits are not in it."
  exit 1
fi

status="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$port/" || true)"
if [[ "$status" != "200" ]]; then
  echo "FAIL: http://localhost:$port/ returned $status. rspack may still be compiling."
  exit 1
fi

if ! grep -q "honeybee_recommended_layouts" "$root/packages/studio-web/public/cos-config.js"; then
  echo "WARN: cos-config.js lacks honeybee_recommended_layouts=true. The cloud record opens the last personal layout instead."
fi

echo "OK: pid $pid serves $root on port $port (HTTP 200)"
echo "branch $(git -C "$root" rev-parse --abbrev-ref HEAD) at $(git -C "$root" -c log.showSignature=false log -1 --format='%h %s' 2>/dev/null | head -1)"
