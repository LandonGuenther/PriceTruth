#!/usr/bin/env bash
# Deploy PriceTruth API staging to Fly.io against the existing Neon database.
#
# Required env (never printed):
#   FLY_API_TOKEN
#   DATABASE_URL
# Optional env:
#   INTERNAL_API_TOKEN   (generated if missing)
#   BESTBUY_API_KEY
#   FLY_APP_NAME         (default: pricetruth-api-staging)
#   FLY_ORG              (optional org slug for first create)
#
# Usage (from repo root):
#   ./scripts/deploy-staging.sh
#
# After a successful deploy + smoke check this also runs
# scripts/fly-schedule-jobs.sh, which updates the Fly scheduled job Machines
# (pricetruth-rollup / pricetruth-archive / pricetruth-bestbuy-refresh) to the
# just-deployed image — so a redeploy never leaves jobs on a stale image.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

APP="${FLY_APP_NAME:-pricetruth-api-staging}"
EXT_ID="hkpcfcjmogoaakoemandjkkdgnhpdejk"
API_URL=""
PATH="$HOME/.fly/bin:$PATH"

need() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "missing required env: $name" >&2
    exit 1
  fi
  echo "$name: present"
}

echo "== preflight =="
need FLY_API_TOKEN
need DATABASE_URL
command -v flyctl >/dev/null || command -v fly >/dev/null || {
  echo "flyctl not installed" >&2
  exit 1
}
FLY="$(command -v flyctl || command -v fly)"

if [ -z "${INTERNAL_API_TOKEN:-}" ]; then
  INTERNAL_API_TOKEN="$(openssl rand -hex 32)"
  echo "INTERNAL_API_TOKEN: generated (not printed)"
else
  echo "INTERNAL_API_TOKEN: present"
fi
if [ -n "${BESTBUY_API_KEY:-}" ]; then
  echo "BESTBUY_API_KEY: present"
else
  echo "BESTBUY_API_KEY: absent (Best Buy official refresh will stay disabled)"
fi

echo "== neon connectivity (non-destructive) =="
# Use prisma migrate status only; do not print connection details.
export DATABASE_URL
pnpm --filter @pricetruth/api exec prisma migrate status

echo "== fly auth =="
"$FLY" auth whoami >/dev/null
echo "fly auth: ok"

echo "== ensure app $APP =="
if ! "$FLY" apps list -q 2>/dev/null | grep -qx "$APP"; then
  create_args=(apps create "$APP" --machines)
  if [ -n "${FLY_ORG:-}" ]; then
    create_args+=(--org "$FLY_ORG")
  fi
  "$FLY" "${create_args[@]}" || "$FLY" apps create "$APP"
fi

echo "== fly secrets =="
secret_args=(
  secrets set
  -a "$APP"
  "DATABASE_URL=$DATABASE_URL"
  "INTERNAL_API_TOKEN=$INTERNAL_API_TOKEN"
  "ALLOWED_EXTENSION_IDS=$EXT_ID"
  "ARCHIVE_BACKEND=local"
  "ARCHIVE_LOCAL_DIR=/data/archive"
  "NODE_ENV=staging"
)
if [ -n "${BESTBUY_API_KEY:-}" ]; then
  secret_args+=("BESTBUY_API_KEY=$BESTBUY_API_KEY")
fi
"$FLY" "${secret_args[@]}"

echo "== deploy =="
SHA="$(git rev-parse --short HEAD)"
"$FLY" deploy -a "$APP" --build-arg APP_VERSION="$SHA" --strategy rolling

API_URL="$("$FLY" info -a "$APP" --json 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("Hostname") or "")' || true)"
if [ -z "$API_URL" ]; then
  API_URL="${APP}.fly.dev"
fi
case "$API_URL" in
  https://*) ;;
  *) API_URL="https://$API_URL" ;;
esac
echo "API_URL=$API_URL"

echo "== public health =="
health="$(curl -sS -o /tmp/pt-health.json -w '%{http_code}' --max-time 20 "$API_URL/health" || echo 000)"
ready="$(curl -sS -o /tmp/pt-ready.json -w '%{http_code}' --max-time 20 "$API_URL/readiness" || echo 000)"
echo "GET /health -> $health"
echo "GET /readiness -> $ready"
if [ "$health" != "200" ] || [ "$ready" != "200" ]; then
  echo "health/readiness failed" >&2
  cat /tmp/pt-health.json /tmp/pt-ready.json >&2 || true
  exit 1
fi

echo "== internal auth smoke =="
unauth="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$API_URL/internal/status" || echo 000)"
wrong="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 -H "Authorization: Bearer wrong-token-value-XXXXXXXX" "$API_URL/internal/status" || echo 000)"
ok="$(curl -sS -o /tmp/pt-status.json -w '%{http_code}' --max-time 15 -H "Authorization: Bearer $INTERNAL_API_TOKEN" "$API_URL/internal/status" || echo 000)"
echo "unauth /internal/status -> $unauth (expect 404)"
echo "wrong  /internal/status -> $wrong (expect 404)"
echo "auth   /internal/status -> $ok (expect 200)"
if [ "$ok" != "200" ]; then
  echo "authenticated internal status failed" >&2
  exit 1
fi

echo "== job machines =="
# Refresh scheduled job Machines to the new image (idempotent).
"$ROOT/scripts/fly-schedule-jobs.sh"

echo "== done =="
echo "Export for follow-up steps (owner/agent):"
echo "  export PRICETRUTH_API_URL=$API_URL"
echo "  export INTERNAL_API_TOKEN=*** (from fly secrets / generator; not re-printed)"
echo "Remember: store INTERNAL_API_TOKEN in a password manager; it is not in git."
