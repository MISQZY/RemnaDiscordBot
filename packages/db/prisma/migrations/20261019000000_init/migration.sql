-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Guild" (
    "id" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'ru',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Moscow',
    "modRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "premiumTier" INTEGER NOT NULL DEFAULT 0,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "Guild_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuildModuleConfig" (
    "guildId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL,
    "version" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "GuildModuleConfig_pkey" PRIMARY KEY ("guildId","moduleId")
);

-- CreateTable
CREATE TABLE "DashboardUser" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "avatar" TEXT,
    "locale" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DashboardUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardAuditLog" (
    "id" BIGSERIAL NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "moduleId" TEXT,
    "action" TEXT NOT NULL,
    "diff" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DashboardAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledAction" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL,
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduledAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DashboardAuditLog_guildId_createdAt_idx" ON "DashboardAuditLog"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "ScheduledAction_runAt_doneAt_idx" ON "ScheduledAction"("runAt", "doneAt");

-- CreateIndex
CREATE INDEX "ScheduledAction_guildId_idx" ON "ScheduledAction"("guildId");

-- AddForeignKey
ALTER TABLE "GuildModuleConfig" ADD CONSTRAINT "GuildModuleConfig_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

