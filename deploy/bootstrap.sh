#!/usr/bin/env bash
set -euo pipefail

ROOT=/opt/barber

if [[ "$(id -u)" -ne 0 ]]; then
  echo "run as root: sudo bash bootstrap.sh"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "install Docker Engine + Compose plugin first"
  exit 1
fi

DEPLOY_USER="${SUDO_USER:-$USER}"

docker network create barber-proxy 2>/dev/null || true

mkdir -p "$ROOT/proxy" "$ROOT/stage" "$ROOT/prod"
cp -f Caddyfile "$ROOT/proxy/Caddyfile"
cp -f proxy.docker-compose.yml "$ROOT/proxy/docker-compose.yml"
cp -f docker-compose.yml "$ROOT/stage/docker-compose.yml"
cp -f docker-compose.yml "$ROOT/prod/docker-compose.yml"
cp -f update-image.sh "$ROOT/update-image.sh"
chmod +x "$ROOT/update-image.sh"

if [[ ! -f "$ROOT/stage/.env" ]]; then
  cp -f .env.stage.example "$ROOT/stage/.env"
  echo "edit $ROOT/stage/.env before the first staging deploy"
fi

if [[ ! -f "$ROOT/prod/.env" ]]; then
  cp -f .env.prod.example "$ROOT/prod/.env"
  echo "edit $ROOT/prod/.env before the first production deploy"
fi

if [[ ! -f "$ROOT/proxy/.env" ]]; then
  grep '^CADDY_EMAIL=' "$ROOT/stage/.env" >"$ROOT/proxy/.env" || echo 'CADDY_EMAIL=you@barbearia360.app' >"$ROOT/proxy/.env"
fi

chown -R "$DEPLOY_USER:$DEPLOY_USER" "$ROOT"

echo "bootstrap complete. next:"
echo "  1. edit $ROOT/stage/.env and $ROOT/prod/.env"
echo "  2. docker login ghcr.io"
echo "  3. cd $ROOT/proxy && docker compose up -d"
