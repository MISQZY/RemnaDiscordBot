-- CreateTable
CREATE TABLE "BotMessage" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "message" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledMessage" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "message" JSONB NOT NULL,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "intervalMin" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StickyMessage" (
    "channelId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "message" JSONB NOT NULL,
    "lastMessageId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StickyMessage_pkey" PRIMARY KEY ("channelId")
);

-- CreateTable
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "dm" BOOLEAN NOT NULL DEFAULT false,
    "runAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BotMessage_guildId_idx" ON "BotMessage"("guildId");

-- CreateIndex
CREATE INDEX "ScheduledMessage_guildId_idx" ON "ScheduledMessage"("guildId");

-- CreateIndex
CREATE INDEX "StickyMessage_guildId_idx" ON "StickyMessage"("guildId");

-- CreateIndex
CREATE INDEX "Reminder_guildId_userId_idx" ON "Reminder"("guildId", "userId");

