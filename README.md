# DiscordBot

Модульный Discord-бот с API-first архитектурой: каждая функция — отдельный модуль, настройки гильдий хранятся в БД, меняются через REST API и применяются ботом без перезапуска.

## Стек

TypeScript, Node.js 24, pnpm + Turborepo, discord.js 14 + discord-hybrid-sharding, Fastify 5, PostgreSQL + Prisma, Redis, zod, pino, Vitest.

## Структура

```
apps/bot              менеджер кластеров и процесс кластера
apps/api              REST API /v1 для веб-платформы (Fastify, OpenAPI на /docs)
apps/worker           отложенные задачи и периодические опросы модулей
packages/core         контракт модуля, реестр, ConfigService, диспетчер событий
packages/contracts    общие zod-схемы и DTO API
packages/db           Prisma-схема, клиент, SQLite-вариант для локального режима
packages/discord      снапшоты гильдий в Redis, переменные шаблонов из discord.js
packages/templates    шаблоны сообщений с плейсхолдерами
packages/i18n         переводы ru/en
packages/logger       pino
packages/module-list  список модулей, общий для бота и API
packages/modules/*    модули бота
packages/testing      SQLite и in-memory Redis для тестов и локального запуска
```

## Модули

| Модуль | Что делает |
|---|---|
| `general` | `/ping`, `/help` — всегда включён |
| `welcome` | приветствия и прощания в канал и ЛС, `/welcome test` |
| `autoroles` | роли при входе (с задержкой), восстановление ролей при возвращении, панели ролей с кнопками и списком |
| `moderation` | `/ban /unban /kick /mute /unmute /warn /warns /unwarn /case /clear`, кейсы, автоэскалация предупреждений, временные баны |
| `audit-log` | журнал сообщений, участников, голоса, сервера и банов в выбранные каналы |
| `leveling` | опыт за сообщения, уровни, роли-награды, `/rank`, `/leaderboard`, `/xp`, публичный лидерборд |
| `custom-commands` | свои slash-команды и автоответы по триггерам |
| `notifications` | оповещения о новых видео YouTube и стримах Twitch |

Модули включаются и настраиваются через API (`/v1/guilds/:id/modules/:module`).

> [!IMPORTANT]
> Модули используют привилегированные intents. Включите их в Developer Portal → Bot → Privileged Gateway Intents:
> **Server Members** (welcome, autoroles, audit-log) и **Message Content** (audit-log, custom-commands).
> Иначе бот не подключится к Discord (ошибка «Used disallowed intents»).

Для оповещений о стримах нужны `TWITCH_CLIENT_ID` и `TWITCH_CLIENT_SECRET` (приложение на dev.twitch.tv); YouTube работает без ключей.

## Быстрый старт без контейнеров

```sh
corepack enable
pnpm install
cp .env.example .env          # DISCORD_TOKEN, DISCORD_CLIENT_ID, для API — DISCORD_CLIENT_SECRET
pnpm deploy-commands          # зарегистрировать slash-команды
pnpm dev:local                # бот + API на SQLite и in-memory Redis
```

`dev:local` хранит базу в `.local/dev.db` (сохраняется между запусками) и поднимает Redis-совместимый сервер в памяти на `127.0.0.1:6390`; запускаются бот (один кластер), воркер и API. Без `DISCORD_CLIENT_SECRET` API не запускается.

## Запуск с Postgres и Redis

```sh
docker compose up -d postgres redis
pnpm db:deploy                # применить миграции
pnpm dev                      # бот, воркер и API в watch-режиме
```

Полностью в Docker: `docker compose --profile app up -d --build`.

## API

- Swagger UI и OpenAPI: `http://localhost:3000/docs`
- Вход: в Developer Portal → OAuth2 добавьте Redirect `http://localhost:3000/v1/auth/callback`, затем откройте `http://localhost:3000/v1/auth/login`. После входа откроется Swagger UI с активной сессией (пока нет веба — `WEB_ORIGIN` пуст).
- Состояние кластеров бота: `GET /v1/status`, health: `/health`, `/ready`.

## Команды

| Команда | Что делает |
|---|---|
| `pnpm dev:local` | бот + API без Postgres, Redis и контейнеров |
| `pnpm dev` | все приложения в watch-режиме (нужны Postgres и Redis) |
| `pnpm build` | сборка всех пакетов |
| `pnpm check` | lint + typecheck + все тесты |
| `pnpm db:migrate` | новая миграция по изменениям схемы |
| `pnpm db:deploy` | применить миграции |
| `pnpm deploy-commands` | регистрация slash-команд (с `--global` — глобально) |

Состояние бота: `GET http://localhost:3001/health`.

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
- `createTestRedis()` — изолированный `ioredis-mock`; `startMemoryRedisServer()` — тот же мок по протоколу Redis для нескольких процессов.
- API тестируется через `app.inject` с фейковым Discord OAuth.

Миграции Postgres тестами не проверяются: их применяет `pnpm db:deploy`.
