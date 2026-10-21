-- CreateTable
CREATE TABLE "Giveaway" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "prize" TEXT NOT NULL,
    "description" TEXT,
    "winners" INTEGER NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "hostId" TEXT NOT NULL,
    "requiredRoleIds" JSONB NOT NULL DEFAULT '[]',
    "minMemberDays" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'running',
    "winnerIds" JSONB NOT NULL DEFAULT '[]',
    "entries" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Giveaway_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiveawayEntry" (
    "giveawayId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiveawayEntry_pkey" PRIMARY KEY ("giveawayId","userId")
);

-- CreateIndex
CREATE INDEX "Giveaway_guildId_status_idx" ON "Giveaway"("guildId", "status");

