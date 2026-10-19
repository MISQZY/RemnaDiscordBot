# Monorepo app image: docker build --build-arg APP=bot|api|worker.
# Size optimization (pruning dev dependencies, multi-stage) — stage 3.
FROM node:24-alpine

ARG APP=bot
ARG HEALTH_PORT=3001

# The Prisma engine needs openssl on musl.
RUN apk add --no-cache openssl && corepack enable
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json eslint.config.js ./
COPY packages ./packages
COPY apps ./apps
COPY scripts ./scripts

RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@bot/${APP}...

ENV NODE_ENV=production
ENV HEALTH_PORT=${HEALTH_PORT}
WORKDIR /repo/apps/${APP}

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${HEALTH_PORT}/health || exit 1

CMD ["node", "dist/index.js"]
