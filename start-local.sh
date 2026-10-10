#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
children=()
cleanup() {
  trap - EXIT INT TERM
  for pid in "${children[@]}"; do kill "$pid" 2>/dev/null || true; done
  for pid in "${children[@]}"; do wait "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT
trap 'exit 130' INT TERM
command -v node >/dev/null || { printf '请先安装 Node.js 22。\n'; exit 1; }
command -v npm >/dev/null || { printf '未找到 npm。\n'; exit 1; }
if [ ! -d node_modules ]; then npm ci; fi
if [ ! -d apps/admin/node_modules ]; then npm ci --prefix apps/admin; fi

if ! npm run db:check; then
  command -v docker >/dev/null || { printf '请先安装并启动 Docker Desktop。\n'; exit 1; }
  if ! docker info >/dev/null 2>&1; then
    open -a Docker
    for ((i=0; i<60; i++)); do
      if docker info >/dev/null 2>&1; then break; fi
      sleep 2
    done
  fi
  npm run db:up
fi

if curl -fsS --max-time 3 http://127.0.0.1:3114/api/v1/health/ready >/dev/null; then
  printf '复用已运行的 API。\n'
else
  if lsof -nP -iTCP:3114 -sTCP:LISTEN >/dev/null 2>&1; then
    printf '3114 端口被其他服务占用，未启动 API。\n'; exit 1
  fi
  npm run db:generate
  npm run db:migrate
  npm run build
  FILE_STORAGE=local PORT=3114 node --env-file-if-exists=.env dist/apps/api/main.js &
  children+=("$!")
  ready=0
  for ((i=0; i<60; i++)); do
    if curl -fsS --max-time 2 http://127.0.0.1:3114/api/v1/health/ready >/dev/null 2>&1; then ready=1; break; fi
    kill -0 "${children[0]}" 2>/dev/null || break
    sleep 1
  done
  [ "$ready" = 1 ] || { printf 'API 启动失败，请查看上方日志。\n'; exit 1; }
fi

if lsof -nP -iTCP:4174 -sTCP:LISTEN >/dev/null 2>&1; then
  if ! curl -fsS --max-time 3 http://127.0.0.1:4174/@vite/client >/dev/null; then
    printf '4174 端口被其他服务占用。\n'; exit 1
  fi
  printf '复用已运行的后台开发服务。\n'
else
  ADMIN_API_TARGET=http://127.0.0.1:3114 node apps/admin/node_modules/vite/bin/vite.js --config apps/admin/vite.config.mjs --host 127.0.0.1 --port 4174 --strictPort apps/admin &
  children+=("$!")
  ready=0
  for ((i=0; i<30; i++)); do
    if curl -fsS --max-time 2 http://127.0.0.1:4174/@vite/client >/dev/null 2>&1; then ready=1; break; fi
    sleep 1
  done
  [ "$ready" = 1 ] || { printf '后台启动失败，请查看上方日志。\n'; exit 1; }
fi
printf '\n后台：http://127.0.0.1:4174\nAPI：http://127.0.0.1:3114/api/v1\n关闭窗口会停止本次启动的服务，已存在的服务不受影响。\n'
open http://127.0.0.1:4174 || true
if [ "${#children[@]}" -gt 0 ]; then
  while true; do
    for pid in "${children[@]}"; do
      kill -0 "$pid" 2>/dev/null || { printf '服务已退出。\n'; exit 1; }
    done
    sleep 2
  done
fi
