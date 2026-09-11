#!/usr/bin/env bash
# Per-boot startup for the PriceTruth Cloud Agent environment.
# Only ephemeral runtime state belongs here: start the Postgres process (its
# data directory and schema were prepared in install.sh) and ensure .env exists.
# The API server itself runs as a named terminal so its logs stay visible.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PG_VERSION="$(ls /usr/lib/postgresql | sort -n | tail -1)"
sudo pg_ctlcluster "$PG_VERSION" main start 2>/dev/null || true
for _ in $(seq 1 30); do
  if pg_isready -h localhost -p 5432 >/dev/null 2>&1; then break; fi
  sleep 1
done

[ -f .env ] || cp .env.example .env
