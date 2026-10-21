-- CreateTable
CREATE TABLE "InfoPanel" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "kind" TEXT NOT NULL,
    "message" JSONB NOT NULL,
    "items" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InfoPanel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InfoPanel_guildId_idx" ON "InfoPanel"("guildId");
