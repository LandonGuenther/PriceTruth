#!/usr/bin/env bash
# Create/refresh the Fly scheduled Machines that run PriceTruth batch jobs.
# Idempotent: existing machines are updated to the current app image, missing
# ones are created. Called at the end of scripts/deploy-staging.sh; safe to run
# standalone any time.
#
# Required env (never printed):
#   FLY_API_TOKEN
# Optional env:
#   FLY_APP_NAME         (default: pricetruth-api-staging)
#   FLY_REGION           (default: iad)
#
# Usage (from repo root):
#   FLY_API_TOKEN=... ./scripts/fly-schedule-jobs.sh
set -euo pipefail

APP="${FLY_APP_NAME:-pricetruth-api-staging}"
REGION="${FLY_REGION:-iad}"
PATH="$HOME/.fly/bin:$PATH"

[ -n "${FLY_API_TOKEN:-}" ] || { echo "missing required env: FLY_API_TOKEN" >&2; exit 1; }
command -v flyctl >/dev/null || command -v fly >/dev/null || { echo "flyctl not installed" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq not installed" >&2; exit 1; }
FLY="$(command -v flyctl || command -v fly)"

MACHINES_JSON="$("$FLY" machines list -a "$APP" --json)"

# Current image of the serving (app) machine — job machines run the same image.
IMG="$(echo "$MACHINES_JSON" \
  | jq -r '.[] | select(.config.metadata.fly_process_group=="app") | .config.image' \
  | head -1)"
if [ -z "$IMG" ]; then
  echo "could not determine current app image for $APP" >&2
  exit 1
fi
echo "app image: $IMG"

machine_id() {
  echo "$MACHINES_JSON" | jq -r --arg n "$1" '.[] | select(.name==$n) | .id' | head -1
}

# ensure_job <name> <schedule> <extra machine-run args...> -- <command...>
ensure_job() {
  local name="$1" schedule="$2"; shift 2
  local extra=()
  while [ "$1" != "--" ]; do extra+=("$1"); shift; done
  shift
  local id
  id="$(machine_id "$name")"
  if [ -n "$id" ]; then
    echo "== update $name ($id) -> $IMG =="
    "$FLY" machine update "$id" -a "$APP" --image "$IMG" -y
  else
    echo "== create $name ($schedule) =="
    "$FLY" machine run "$IMG" -a "$APP" -r "$REGION" -y \
      --name "$name" \
      --schedule "$schedule" \
      --vm-memory 256 \
      --autostart=false \
      --restart no \
      --metadata fly_process_group=jobs \
      "${extra[@]}" -- "$@"
  fi
}

# Archive job needs its own volume (pricetruth_archive_jobs:/data) — distinct
# from the API machine's pricetruth_archive volume.
if ! "$FLY" volumes list -a "$APP" --json | jq -e '.[] | select(.name=="pricetruth_archive_jobs")' >/dev/null; then
  echo "== create volume pricetruth_archive_jobs (1GB, $REGION) =="
  "$FLY" volumes create pricetruth_archive_jobs -a "$APP" -r "$REGION" -s 1 -y
fi

ensure_job pricetruth-rollup hourly -- \
  sh -c 'cd /app/apps/api && pnpm jobs rollup'
ensure_job pricetruth-archive daily --volume pricetruth_archive_jobs:/data -- \
  sh -c 'cd /app/apps/api && pnpm jobs archive'
ensure_job pricetruth-bestbuy-refresh daily -- \
  sh -c 'cd /app/apps/api && pnpm jobs bestbuy-refresh --min-age-hours 6 --max-listings 200'

echo "done: job machines for $APP are on image $IMG"
