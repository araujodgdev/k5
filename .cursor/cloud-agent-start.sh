#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="/usr/local/cargo/bin:${PATH}"

DEV_ENV="apps/web/.data/postgres-migration/dev.env"
ENV_FILE="apps/web/.env.local"
SESSION="k5-postgres"

port_open() {
  node -e 'const n=require("node:net"); const s=n.connect(55432,"127.0.0.1",()=>{s.end(); process.exit(0)}); s.on("error",()=>process.exit(1)); setTimeout(()=>process.exit(1),1000)'
}

if ! port_open; then
  tmux kill-session -t "$SESSION" 2>/dev/null || true
  tmux new-session -d -s "$SESSION" "cd '$ROOT' && pnpm --filter @k5/web db:local"
fi

ready=0
for _ in $(seq 1 90); do
  if [[ -f "$DEV_ENV" ]] && port_open; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "$ready" -ne 1 ]]; then
  echo "embedded PostgreSQL did not listen on 127.0.0.1:55432" >&2
  exit 1
fi

python3 - "$DEV_ENV" "$ENV_FILE" <<'PY'
import os, secrets, sys
from pathlib import Path

dev_path, env_path = map(Path, sys.argv[1:3])
wanted = {}
for line in dev_path.read_text().splitlines():
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    if key in {"DATABASE_URL", "DATABASE_URL_UNPOOLED"}:
        wanted[key] = value
if "DATABASE_URL" not in wanted:
    raise SystemExit(f"{dev_path} has no DATABASE_URL")

if env_path.exists():
    lines = env_path.read_text().splitlines()
else:
    # setup.ts writes secrets only when this file is absent. Create the same
    # template, then fill the database URL so the existing secrets stay put.
    secret = secrets.token_urlsafe(48)
    lines = [
        "BETTER_AUTH_URL=http://localhost:3000",
        f"BETTER_AUTH_SECRET={secret}",
        "DATABASE_URL=",
        "SESSION_IDLE_SECONDS=28800",
    ]

seen = set()
out = []
for line in lines:
    if "=" in line and not line.startswith("#"):
        key = line.split("=", 1)[0]
        if key in wanted:
            out.append(f"{key}={wanted[key]}")
            seen.add(key)
            continue
    out.append(line)
for key, value in wanted.items():
    if key not in seen:
        out.append(f"{key}={value}")
text = "\n".join(out) + "\n"
env_path.write_text(text)
os.chmod(env_path, 0o600)
PY

exec pnpm dev
