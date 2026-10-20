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
| `autoroles` | `/autoroles`: роли при входе (с задержкой), восстановление ролей при возвращении, панели ролей с кнопками и списком |
| `moderation` | `/ban /unban /kick /mute /unmute /warn /warns /unwarn /case /clear`, кейсы, автоэскалация предупреждений, временные баны |
| `audit-log` | журнал сообщений, участников, голоса, сервера и банов в выбранные каналы |
| `leveling` | опыт за сообщения, уровни, роли-награды, `/rank`, `/leaderboard`, `/xp`, публичный лидерборд |
| `custom-commands` | свои slash-команды и автоответы по триггерам |
| `notifications` | оповещения о новых видео YouTube и стримах Twitch |
| `music` | музыка через Lavalink: `/play /skip /stop /pause /queue /nowplaying /volume /loop /shuffle /remove /seek`, кнопки плеера, DJ-роли, управление из веба |

Модули включаются командой `/modules enable <модуль>` в Discord или через API (`/v1/guilds/:id/modules/:module`). Модерация включена по умолчанию.

Slash-команды бот синхронизирует с Discord сам при старте. С `DISCORD_DEV_GUILD_ID` они регистрируются в тестовой гильдии (появляются сразу), а глобальные копии удаляются, чтобы не было дублей.

> [!IMPORTANT]
> Модули используют привилегированные intents. Включите их в Developer Portal → Bot → Privileged Gateway Intents:
> **Server Members** (welcome, autoroles, audit-log) и **Message Content** (audit-log, custom-commands).
> Иначе бот не подключится к Discord (ошибка «Used disallowed intents»).

Для музыки нужен узел [Lavalink](https://lavalink.dev) 4.2+: `docker compose --profile music up -d lavalink` и `LAVALINK_NODES=lavalink://<LAVALINK_PASSWORD>@localhost:2333` в `.env` (в Docker — `@lavalink:2333`, `COMPOSE_PROFILES=app,music`). Поиск по умолчанию — SoundCloud; YouTube выключен (плагин в `docker/lavalink/application.yml`).

Для оповещений о стримах нужны `TWITCH_CLIENT_ID` и `TWITCH_CLIENT_SECRET` (приложение на dev.twitch.tv); YouTube работает без ключей.

## Быстрый старт без контейнеров

```sh
corepack enable
pnpm install
cp .env.example .env          # DISCORD_TOKEN, DISCORD_CLIENT_ID, для API — DISCORD_CLIENT_SECRET
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
| `pnpm deploy-commands` | ручная синхронизация slash-команд (обычно не нужна — бот делает это при старте; с `--global` — глобально) |

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

Миграции Postgres тестами не проверяются: CI применяет их к пустой базе и сверяет со схемой (`prisma migrate diff`).

## Продакшн

### CI/CD

`.github/workflows/ci.yml`: на каждый push и PR — `pnpm check` и проверка миграций на Postgres; затем сборка образов `bot`, `worker`, `api`, `migrate` (`docker/app.Dockerfile`). На `main` образы пушатся в GHCR как `ghcr.io/<owner>/<repo>/<образ>:<sha>` и `:latest`. Публикация релиза (или ручной запуск) деплоит этот `<sha>` по SSH.

Секреты репозитория: `SSH_KEY`, `SSH_HOST`, `SSH_PORT`, `SSH_USER`, `DEPLOY_PATH` (путь к клону на сервере).

### Сервер

```sh
git clone <repo> /opt/discord-bot && cd /opt/discord-bot
cp .env.example .env
```

В `.env` сервера, кроме токенов: `IMAGE_REPO=ghcr.io/<owner>/<repo>`, `COMPOSE_PROFILES=app`, свои `POSTGRES_PASSWORD` и `SESSION_SECRET`. Первый запуск — `bash deploy.sh`.

`deploy.sh` подтягивает код, скачивает образы, останавливает приложение, делает дамп базы в `backups/pre-deploy.dump`, применяет миграции и ждёт healthy. Если контейнеры не поднялись — восстанавливает дамп и возвращает прошлые образы. Удачный тег закрепляется в `.env` (`IMAGE_TAG`).

### Мониторинг

Prometheus и Grafana — внешние (стек мониторинга RemnaWeb). `/metrics` отдают менеджер бота (`:3001`, с метриками всех кластеров), воркер (`:3002`) и API (`:9464`, только внутри Docker-сети).

- Тот же сервер: `COMPOSE_FILE=docker-compose.yml:docker/monitoring/shared-network.yml` — контейнеры подключаются к сети `monitoring-network` под именами `discord-bot`, `discord-bot-worker`, `discord-bot-api`.
- Другой сервер: `COMPOSE_FILE=docker-compose.yml:docker/monitoring/published-ports.yml` и `METRICS_TOKEN` — порты `9461`, `9462`, `9464` публикуются, доступ по bearer-токену. Docker обходит UFW, поэтому IP мониторинга ограничивайте ещё и фаерволом хостера.

Задания для `prometheus.yml` — `docker/monitoring/prometheus-scrape.yml`, дашборд для импорта в Grafana — `docker/monitoring/grafana-dashboard.json`.

### Бэкапы

```sh
# cron: каждый день в 04:15
15 4 * * * cd /opt/discord-bot && bash backup.sh >> backups/backup.log 2>&1
```

`backup.sh` кладёт `pg_dump` в `backups/` и хранит последние `BACKUP_KEEP` (14). С `BACKUP_REMOTE` (remote rclone) копии уходят и за пределы сервера. Восстановление: `bash restore.sh backups/db-<дата>.dump`. Redis не бэкапится — в нём кэши и сессии, он сохраняется AOF.

### Ротация секретов

- **Токен бота**: Developer Portal → Bot → Reset Token, новый `DISCORD_TOKEN` в `.env`, затем `docker compose up -d bot worker api`.
- **`SESSION_SECRET`**: после смены все сессии панели становятся недействительными — пользователи входят заново.
- **`METRICS_TOKEN`**: меняется одновременно в `.env` бота и в файле токена у Prometheus.

### Нагрузочный тест

`k6 run scripts/load/api.k6.js` (API с `API_RATE_LIMIT_PER_MINUTE=0`; `SID` — cookie сессии для авторизованных запросов).

### Документы для верификации

Черновики политики конфиденциальности и условий использования — `legal/`. Перед публикацией заполните оператора и контакты.
