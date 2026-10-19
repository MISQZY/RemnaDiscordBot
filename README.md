# DiscordBot

Модульный Discord-бот с API-first архитектурой: каждая функция — отдельный модуль, настройки гильдий хранятся в Postgres и применяются без перезапуска.

## Стек

TypeScript, Node.js 24, pnpm + Turborepo, discord.js 14 + discord-hybrid-sharding, PostgreSQL + Prisma, Redis, zod, pino, Vitest.

## Структура

```
apps/bot              менеджер кластеров и процесс кластера
packages/core         контракт модуля, реестр, ConfigService, диспетчер событий
packages/contracts    общие zod-схемы
packages/db           Prisma-схема и клиент
packages/discord      снапшоты гильдий в Redis
packages/i18n         переводы ru/en
packages/logger       pino
packages/modules/*    модули бота
```

## Быстрый старт

```sh
corepack enable
pnpm install
cp .env.example .env          # заполнить DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_DEV_GUILD_ID
docker compose up -d postgres redis
pnpm db:deploy                # применить миграции
pnpm deploy-commands          # зарегистрировать slash-команды
pnpm dev                      # бот в watch-режиме
```

Полностью в Docker: `docker compose --profile app up -d --build`.

## Команды

| Команда | Что делает |
|---|---|
| `pnpm dev` | запуск в watch-режиме |
| `pnpm build` | сборка всех пакетов |
| `pnpm check` | lint + typecheck + тесты |
| `pnpm db:migrate` | новая миграция по изменениям схемы |
| `pnpm db:deploy` | применить миграции |
| `pnpm deploy-commands` | регистрация slash-команд (с `--global` — глобально) |

Состояние кластеров: `GET http://localhost:3001/health`.

## Тесты

Тестам не нужны ни контейнеры, ни Postgres, ни Redis.

| Команда | Что делает |
|---|---|
| `pnpm test` | unit-тесты (`*.test.ts`) |
| `pnpm test:integration` | интеграционные тесты (`*.int.test.ts`) на SQLite и in-memory Redis |
| `pnpm check` | lint + typecheck + оба вида тестов |

Как это устроено:
- `packages/db/scripts/sqlite.mjs` строит из `schema.prisma` SQLite-вариант и отдельный Prisma-клиент (`packages/db/generated`, не в git). Схема должна оставаться переносимой: без скалярных списков и `@db.*` — скрипт падает, если они появятся.
- Global setup один раз создаёт шаблонную базу; `createTestDatabase()` из `@bot/testing` даёт каждому тестовому файлу её копию.
- `createTestRedis()` — изолированный `ioredis-mock` с поддержкой pub/sub.

Миграции Postgres тестами не проверяются: их применяет `pnpm db:deploy`.
