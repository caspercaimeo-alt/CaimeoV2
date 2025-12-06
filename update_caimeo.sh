#!/usr/bin/env bash
# Update Caimeo to the latest commit on origin/main, restart backend/frontend.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND_LOG="/tmp/caimeo_uvicorn.log"
FRONTEND_LOG="/tmp/caimeo_frontend.log"

info()  { printf "==> %s\n" "$*"; }
warn()  { printf "WARN: %s\n" "$*" >&2; }

cd "$ROOT"

SSH_CMD="${GIT_SSH_COMMAND:-ssh -i ~/.ssh/id_ed25519_caimeo -o StrictHostKeyChecking=accept-new}"

info "Fetching latest commits..."
GIT_SSH_COMMAND="$SSH_CMD" git fetch

LOCAL_HEAD=$(git rev-parse HEAD)
REMOTE_HEAD=$(git rev-parse origin/main)

if [ "$LOCAL_HEAD" = "$REMOTE_HEAD" ]; then
  info "Already up to date. Restarting services anyway."
else
  info "Updating to origin/main..."
  GIT_SSH_COMMAND="$SSH_CMD" git pull --ff-only
fi

info "Stopping existing backend/frontend if running..."
pkill -f "uvicorn server:app" 2>/dev/null || true
pkill -f "npm --prefix alpaca-ui start" 2>/dev/null || true
pkill -f "react-scripts start" 2>/dev/null || true
sleep 1

UVICORN_BIN="$ROOT/venv/bin/uvicorn"
if [ ! -x "$UVICORN_BIN" ]; then
  warn "venv uvicorn not found; falling back to system uvicorn on PATH."
  UVICORN_BIN="uvicorn"
fi

info "Starting backend (uvicorn on :8000)..."
nohup "$UVICORN_BIN" server:app --host 0.0.0.0 --port 8000 >"$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!

info "Starting frontend (npm start on :3000)..."
nohup npm --prefix "$ROOT/alpaca-ui" start >"$FRONTEND_LOG" 2>&1 &
FRONTEND_PID=$!

sleep 3

info "Backend PID: $BACKEND_PID (log: $BACKEND_LOG)"
info "Frontend PID: $FRONTEND_PID (log: $FRONTEND_LOG)"
info "Check ports with: lsof -i :8000 -i :3000"
info "Tail logs with: tail -f $BACKEND_LOG $FRONTEND_LOG"
