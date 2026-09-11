#!/usr/bin/env bash
# Idempotent repository bootstrap for the PriceTruth Cloud Agent environment.
# Durable, source-derived setup lives here: system packages, local Postgres,
# Node dependencies, Prisma client generation, schema migration/seed, and build.
# Per-boot process startup lives in start.sh; do not launch long-lived servers here.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# 1. System dependency: PostgreSQL. The docker-compose dev DB is Postgres 16
#    (user/password/db all "pricetruth" on :5432); we mirror that with a local
#    apt cluster so DATABASE_URL from .env.example works unchanged.
if ! command -v pg_ctlcluster >/dev/null 2>&1; then
  sudo apt-get update
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql postgresql-contrib
fi

PG_VERSION="$(ls /usr/lib/postgresql | sort -n | tail -1)"

# 2. Ensure the cluster is online for the setup steps below (idempotent).
sudo pg_ctlcluster "$PG_VERSION" main start 2>/dev/null || true
for _ in $(seq 1 30); do
  if pg_isready -h localhost -p 5432 >/dev/null 2>&1; then break; fi
  sleep 1
done

# 3. Role and database matching docker-compose.yml (idempotent).
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='pricetruth'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE ROLE pricetruth LOGIN PASSWORD 'pricetruth';"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='pricetruth'" | grep -q 1 \
  || sudo -u postgres createdb -O pricetruth pricetruth

# 4. Local env file (gitignored). Provides DATABASE_URL and PORT.
[ -f .env ] || cp .env.example .env

# 5. Workspace dependencies and Prisma client.
pnpm install --frozen-lockfile
pnpm --filter @pricetruth/api prisma:generate

# 6. Build all workspace packages, apps, and the extension bundle.
#    This must run before db:seed because prisma/seed.ts imports the compiled
#    @pricetruth/shared output (packages/shared/dist).
pnpm build

# 7. Apply migrations and seed retailers (both idempotent).
set -a
# shellcheck disable=SC1091
source .env
set +a
pnpm --filter @pricetruth/api exec prisma migrate deploy
pnpm --filter @pricetruth/api db:seed
