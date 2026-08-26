#!/usr/bin/env bash
set -euo pipefail

ENV_NAME="${1:?env is required (stage|prod)}"
SERVICE="${2:?service is required (api|web|crm)}"
IMAGE="${3:?image is required}"

ROOT="/opt/barber/${ENV_NAME}"
cd "$ROOT"

if [[ ! -f docker-compose.yml || ! -f .env ]]; then
  echo "missing $ROOT/docker-compose.yml or .env — run deploy/bootstrap.sh on the VPS first"
  exit 1
fi

KEY="API_IMAGE"
if [[ "$SERVICE" == "web" ]]; then
  KEY="WEB_IMAGE"
elif [[ "$SERVICE" == "crm" ]]; then
  KEY="CRM_IMAGE"
elif [[ "$SERVICE" != "api" ]]; then
  echo "service must be api, web or crm"
  exit 1
fi

tmp="$(mktemp)"
awk -v key="$KEY" -v val="$IMAGE" '
  BEGIN { done = 0 }
  $0 ~ "^" key "=" { print key "=" val; done = 1; next }
  { print }
  END { if (!done) print key "=" val }
' .env >"$tmp"
mv "$tmp" .env

if [[ "$SERVICE" == "api" ]]; then
  docker compose pull postgres api
  docker compose up -d postgres api
else
  docker compose pull "$SERVICE"
  docker compose up -d "$SERVICE"
fi
