-- CreateTable
CREATE TABLE "TicketPanel" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "kind" TEXT NOT NULL,
    "message" JSONB NOT NULL,
    "categories" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketPanel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "channelId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "panelId" TEXT,
    "categoryId" TEXT,
    "categoryLabel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "claimedBy" TEXT,
    "answers" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "closeReason" TEXT,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketCounter" (
    "guildId" TEXT NOT NULL,
    "last" INTEGER NOT NULL,

    CONSTRAINT "TicketCounter_pkey" PRIMARY KEY ("guildId")
);

-- CreateIndex
CREATE INDEX "TicketPanel_guildId_idx" ON "TicketPanel"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_channelId_key" ON "Ticket"("channelId");

-- CreateIndex
CREATE INDEX "Ticket_guildId_status_idx" ON "Ticket"("guildId", "status");

-- CreateIndex
CREATE INDEX "Ticket_status_lastActivityAt_idx" ON "Ticket"("status", "lastActivityAt");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_guildId_number_key" ON "Ticket"("guildId", "number");

