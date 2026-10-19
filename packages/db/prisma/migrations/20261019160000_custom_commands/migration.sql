-- CreateTable
CREATE TABLE "CustomCommand" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT,
    "matchMode" TEXT,
    "pattern" TEXT,
    "response" JSONB NOT NULL,
    "ephemeral" BOOLEAN NOT NULL DEFAULT false,
    "actions" JSONB NOT NULL,
    "allowedChannelIds" JSONB NOT NULL,
    "allowedRoleIds" JSONB NOT NULL,
    "cooldownSec" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "discordCommandId" TEXT,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomCommand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomCommand_guildId_name_key" ON "CustomCommand"("guildId", "name");

