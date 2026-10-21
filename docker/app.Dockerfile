# Monorepo app image: docker build --build-arg APP=bot|api|worker [--target migrate].
FROM node:26-alpine AS base
# The Prisma engine needs openssl on musl.
RUN apk add --no-cache openssl && corepack enable
WORKDIR /repo

# Full install and build; also the image of the one-off migration container (needs the prisma CLI).
FROM base AS build
ARG APP=bot
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json eslint.config.js ./
COPY packages ./packages
COPY apps ./apps
COPY scripts ./scripts
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@bot/${APP}...

FROM build AS migrate
WORKDIR /repo/packages/db
CMD ["pnpm", "db:deploy"]

# Drop dev dependencies and sources: apps run from dist. Scripts are skipped — the Prisma client is already generated.
# `pnpm prune` is not workspace-aware and unlinks the @bot/* packages from the apps; the offline install links them back.
FROM build AS prune
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
  CI=true pnpm prune --prod --ignore-scripts \
  && CI=true pnpm install --prod --frozen-lockfile --offline --ignore-scripts \
  && find packages apps -name node_modules -prune -o -type d -name src -print | xargs rm -rf

FROM node:26-alpine AS runtime
ARG APP=bot
ARG HEALTH_PORT=3001
RUN apk add --no-cache openssl
ENV NODE_ENV=production
ENV HEALTH_PORT=${HEALTH_PORT}
COPY --from=prune /repo /repo
USER node
WORKDIR /repo/apps/${APP}

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${HEALTH_PORT}/health || exit 1

CMD ["node", "dist/index.js"]
