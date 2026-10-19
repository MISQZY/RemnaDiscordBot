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
