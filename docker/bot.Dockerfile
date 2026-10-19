# Сборка всего монорепо в одном образе: бот и одноразовые задачи (миграции, деплой команд).
# Оптимизация размера (prune dev-зависимостей, multi-stage) — этап 3.
FROM node:24-alpine

# openssl нужен движку Prisma на musl.
RUN apk add --no-cache openssl && corepack enable
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
COPY apps/bot ./apps/bot
COPY turbo.json eslint.config.js ./

RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@bot/bot...

ENV NODE_ENV=production
WORKDIR /repo/apps/bot
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${BOT_HEALTH_PORT:-3001}/health || exit 1

CMD ["node", "dist/index.js"]
