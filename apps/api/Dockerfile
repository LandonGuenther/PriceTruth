# PriceTruth API image. Build from the repo root:
#   docker build -f apps/api/Dockerfile -t pricetruth-api .
#
# Note: the runtime stage ships devDependencies as well (tsx/prisma CLI/vitest)
# so `prisma migrate deploy` and the ops scripts run inside the container.
# That trades image size for a single, reproducible install; revisit with
# `pnpm deploy` once the workspace graph is stable.

FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo

# Manifests first for layer caching.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/extension/package.json apps/extension/package.json
COPY packages/catalog/package.json packages/catalog/package.json
COPY packages/retailer-adapters/package.json packages/retailer-adapters/package.json
COPY packages/scoring/package.json packages/scoring/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/ packages/
COPY apps/api/ apps/api/
RUN pnpm --filter @pricetruth/api exec prisma generate \
  && pnpm --filter @pricetruth/api... build

FROM node:22-alpine
RUN corepack enable && addgroup -S app && adduser -S app -G app
WORKDIR /app
ENV NODE_ENV=production
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}

COPY --from=build --chown=app:app /repo/node_modules ./node_modules
COPY --from=build --chown=app:app /repo/package.json /repo/pnpm-workspace.yaml ./
COPY --from=build --chown=app:app /repo/packages ./packages
COPY --from=build --chown=app:app /repo/apps/api ./apps/api

USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null || exit 1

WORKDIR /app/apps/api
# Migrations run via: docker run ... pnpm exec prisma migrate deploy
CMD ["node", "dist/src/server.js"]
