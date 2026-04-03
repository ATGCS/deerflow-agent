#!/usr/bin/env bash
#
# start.sh - Start all DeerFlow development services
#
# Must be run from the repo root directory.

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ── Load environment variables from .env ──────────────────────────────────────
if [ -f "$REPO_ROOT/.env" ]; then
    set -a
    source "$REPO_ROOT/.env"
    set +a
fi

# ── Argument parsing ─────────────────────────────────────────────────────────

DEV_MODE=true
for arg in "$@"; do
    case "$arg" in
        --dev)  DEV_MODE=true ;;
        --prod) DEV_MODE=false ;;
        *) echo "Unknown argument: $arg"; echo "Usage: $0 [--dev|--prod]"; exit 1 ;;
    esac
done

# Non-login shells (e.g. WSL automation) often omit /usr/sbin; nginx is usually there on Debian/Ubuntu.
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/sbin:/bin:${PATH}"

UV_BIN="${UV_BIN:-uv}"
if [ -x "$HOME/.local/bin/uv" ]; then
    UV_BIN="$HOME/.local/bin/uv"
fi

# In WSL/Linux, avoid reusing Windows-created backend/.venv.
# WSL + repo on /mnt/*: put the venv on Linux ext4 ($HOME) — uv sync on drvfs is too slow and
# LangGraph may miss the wait-for-port deadline.
# Note: .env may set UV_PROJECT_ENVIRONMENT=.venv-wsl; that still lives on /mnt and stays slow, so
# we force the native path unless DEERFLOW_SKIP_NATIVE_WSL_VENV=1.
_DEFAULT_UV_ENV=".venv-wsl"
if [ -f /proc/version ] && grep -qi microsoft /proc/version 2>/dev/null; then
    case "$REPO_ROOT" in
        /mnt/*)
            _DEFAULT_UV_ENV="${HOME}/.venvs/deerflaw-backend"
            mkdir -p "$(dirname "$_DEFAULT_UV_ENV")"
            ;;
    esac
fi
export UV_PROJECT_ENVIRONMENT="${UV_PROJECT_ENVIRONMENT:-$_DEFAULT_UV_ENV}"
export UV_LINK_MODE="${UV_LINK_MODE:-copy}"
if [ "${DEERFLOW_SKIP_NATIVE_WSL_VENV:-0}" != "1" ] && [ -f /proc/version ] && grep -qi microsoft /proc/version 2>/dev/null; then
    case "$REPO_ROOT" in
        /mnt/*)
            export UV_PROJECT_ENVIRONMENT="${HOME}/.venvs/deerflaw-backend"
            mkdir -p "$(dirname "$UV_PROJECT_ENVIRONMENT")"
            ;;
    esac
fi

# Next.js dev requires Node >=20.9; many WSL images still ship Node 18. Prefer a user install (see scripts/install-node20-wsl.sh).
if [ -x "${HOME}/.local/nodejs/bin/node" ]; then
    _SYS_NODE_MAJ=$(command -v node >/dev/null 2>&1 && node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)
    _LOCAL_NODE_MAJ=$("${HOME}/.local/nodejs/bin/node" -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)
    if [ "${_SYS_NODE_MAJ:-0}" -lt 20 ] && [ "${_LOCAL_NODE_MAJ:-0}" -ge 20 ]; then
        export PATH="${HOME}/.local/nodejs/bin:${PATH}"
    fi
fi

if $DEV_MODE; then
    FRONTEND_CMD="pnpm run dev"
else
    FRONTEND_CMD="env BETTER_AUTH_SECRET=$(python3 -c 'import secrets; print(secrets.token_hex(16))') pnpm run preview"
fi

if [ -n "${NGINX_BIN:-}" ] && [ -x "$NGINX_BIN" ]; then
    :
elif command -v nginx >/dev/null 2>&1; then
    NGINX_BIN=$(command -v nginx)
elif [ -x /usr/sbin/nginx ]; then
    NGINX_BIN=/usr/sbin/nginx
else
    NGINX_BIN=nginx
fi

# ── Stop existing services ────────────────────────────────────────────────────

echo "Stopping existing services if any..."
pkill -f "langgraph dev" 2>/dev/null || true
pkill -f "uvicorn app.gateway.app:app" 2>/dev/null || true
pkill -f "next dev" 2>/dev/null || true
pkill -f "next-server" 2>/dev/null || true
"$NGINX_BIN" -c "$REPO_ROOT/docker/nginx/nginx.local.conf" -p "$REPO_ROOT" -s quit 2>/dev/null || true
sleep 1
pkill -9 nginx 2>/dev/null || true
killall -9 nginx 2>/dev/null || true
./scripts/cleanup-containers.sh deer-flow-sandbox 2>/dev/null || true
sleep 1

# ── Banner ────────────────────────────────────────────────────────────────────

echo ""
echo "=========================================="
echo "  Starting DeerFlow Development Server"
echo "=========================================="
echo ""
if $DEV_MODE; then
    echo "  Mode: DEV  (hot-reload enabled)"
    echo "  Tip:  run \`make start\` in production mode"
else
    echo "  Mode: PROD (hot-reload disabled)"
    echo "  Tip:  run \`make dev\` to start in development mode"
fi
echo ""
echo "Services starting up..."
echo "  → Backend: LangGraph + Gateway"
echo "  → Frontend: Next.js"
echo "  → Nginx: Reverse Proxy"
echo ""

# ── Config check ─────────────────────────────────────────────────────────────

if ! { \
        [ -n "$DEER_FLOW_CONFIG_PATH" ] && [ -f "$DEER_FLOW_CONFIG_PATH" ] || \
        [ -f backend/config.yaml ] || \
        [ -f config.yaml ]; \
    }; then
    echo "✗ No DeerFlow config file found."
    echo "  Checked these locations:"
    echo "    - $DEER_FLOW_CONFIG_PATH (when DEER_FLOW_CONFIG_PATH is set)"
    echo "    - backend/config.yaml"
    echo "    - ./config.yaml"
    echo ""
    echo "  Run 'make config' from the repo root to generate ./config.yaml, then set required model API keys in .env or your config file."
    exit 1
fi

# ── Auto-upgrade config ──────────────────────────────────────────────────

if [ "${DEERFLOW_SKIP_CONFIG_UPGRADE:-0}" != "1" ]; then
    "$REPO_ROOT/scripts/config-upgrade.sh"
else
    echo "Skipping config upgrade (DEERFLOW_SKIP_CONFIG_UPGRADE=1)."
fi

# ── Cleanup trap ─────────────────────────────────────────────────────────────

cleanup() {
    trap - INT TERM
    echo ""
    echo "Shutting down services..."
    pkill -f "langgraph dev" 2>/dev/null || true
    pkill -f "uvicorn app.gateway.app:app" 2>/dev/null || true
    pkill -f "next dev" 2>/dev/null || true
    pkill -f "next start" 2>/dev/null || true
    pkill -f "next-server" 2>/dev/null || true
    # Kill nginx using the captured PID first (most reliable),
    # then fall back to pkill/killall for any stray nginx workers.
    if [ -n "${NGINX_PID:-}" ] && kill -0 "$NGINX_PID" 2>/dev/null; then
        kill -TERM "$NGINX_PID" 2>/dev/null || true
        sleep 1
        kill -9 "$NGINX_PID" 2>/dev/null || true
    fi
    pkill -9 nginx 2>/dev/null || true
    killall -9 nginx 2>/dev/null || true
    echo "Cleaning up sandbox containers..."
    ./scripts/cleanup-containers.sh deer-flow-sandbox 2>/dev/null || true
    echo "✓ All services stopped"
    exit 0
}
trap cleanup INT TERM

# ── Start services ────────────────────────────────────────────────────────────

mkdir -p logs

if $DEV_MODE; then
    LANGGRAPH_EXTRA_FLAGS="--no-reload"
    GATEWAY_EXTRA_FLAGS="--reload --reload-include='*.yaml' --reload-include='.env'"
else
    LANGGRAPH_EXTRA_FLAGS="--no-reload"
    GATEWAY_EXTRA_FLAGS=""
fi
GATEWAY_PORT=8012
export BG_JOB_ISOLATED_LOOPS="${BG_JOB_ISOLATED_LOOPS:-true}"
# langgraph dev subprocess defaults N_JOBS_PER_WORKER to 1 unless --n-jobs-per-worker is set
export N_JOBS_PER_WORKER="${N_JOBS_PER_WORKER:-10}"

echo "Starting LangGraph server..."
# Read log_level from config.yaml, fallback to env var, then to "info"
CONFIG_LOG_LEVEL=$(grep -m1 '^log_level:' config.yaml 2>/dev/null | awk '{print $2}' | tr -d ' ')
LANGGRAPH_LOG_LEVEL="${LANGGRAPH_LOG_LEVEL:-${CONFIG_LOG_LEVEL:-info}}"
(cd backend && NO_COLOR=1 PYTHONUNBUFFERED=1 "$UV_BIN" run langgraph dev --no-browser --allow-blocking --n-jobs-per-worker "$N_JOBS_PER_WORKER" --server-log-level $LANGGRAPH_LOG_LEVEL $LANGGRAPH_EXTRA_FLAGS > ../logs/langgraph.log 2>&1) &
./scripts/wait-for-port.sh 2024 240 "LangGraph" || {
    echo "  See logs/langgraph.log for details"
    tail -20 logs/langgraph.log
    if grep -qE "config_version|outdated|Environment variable .* not found|KeyError|ValidationError|config\.yaml" logs/langgraph.log 2>/dev/null; then
        echo ""
        echo "  Hint: This may be a configuration issue. Try running 'make config-upgrade' to update your config.yaml."
    fi
    cleanup
}
echo "✓ LangGraph server started on localhost:2024"

echo "Starting Gateway API..."
(cd backend && PYTHONPATH=. "$UV_BIN" run uvicorn app.gateway.app:app --host 0.0.0.0 --port $GATEWAY_PORT $GATEWAY_EXTRA_FLAGS > ../logs/gateway.log 2>&1) &
./scripts/wait-for-port.sh $GATEWAY_PORT 30 "Gateway API" || {
    echo "✗ Gateway API failed to start. Last log output:"
    tail -60 logs/gateway.log
    echo ""
    echo "Likely configuration errors:"
    grep -E "Failed to load configuration|Environment variable .* not found|config\.yaml.*not found" logs/gateway.log | tail -5 || true
    echo ""
    echo "  Hint: Try running 'make config-upgrade' to update your config.yaml with the latest fields."
    cleanup
}
echo "✓ Gateway API started on localhost:$GATEWAY_PORT"

echo "Starting Frontend..."
(cd frontend && $FRONTEND_CMD > ../logs/frontend.log 2>&1) &
./scripts/wait-for-port.sh 3000 120 "Frontend" || {
    echo "  See logs/frontend.log for details"
    tail -20 logs/frontend.log
    cleanup
}
echo "✓ Frontend started on localhost:3000"

if ! command -v "$NGINX_BIN" >/dev/null 2>&1 && [ ! -x "$NGINX_BIN" ]; then
    echo "✗ nginx not found (install: sudo apt install nginx on Debian/Ubuntu/WSL)."
    cleanup
fi
echo "Starting Nginx reverse proxy..."
"$NGINX_BIN" -g 'daemon off;' -c "$REPO_ROOT/docker/nginx/nginx.local.conf" -p "$REPO_ROOT" > logs/nginx.log 2>&1 &
NGINX_PID=$!
./scripts/wait-for-port.sh 2026 10 "Nginx" || {
    echo "  See logs/nginx.log for details"
    tail -10 logs/nginx.log
    cleanup
}
echo "✓ Nginx started on localhost:2026"

# ── Ready ─────────────────────────────────────────────────────────────────────

echo ""
echo "=========================================="
if $DEV_MODE; then
    echo "  ✓ DeerFlow development server is running!"
else
    echo "  ✓ DeerFlow production server is running!"
fi
echo "=========================================="
echo ""
echo "  🌐 Application: http://localhost:2026"
echo "  📡 API Gateway: http://localhost:2026/api/*"
echo "  🤖 LangGraph:   http://localhost:2026/api/langgraph/*"
echo ""
echo "  📋 Logs:"
echo "     - LangGraph: logs/langgraph.log"
echo "     - Gateway:   logs/gateway.log"
echo "     - Frontend:  logs/frontend.log"
echo "     - Nginx:     logs/nginx.log"
echo ""
echo "Press Ctrl+C to stop all services"

wait
