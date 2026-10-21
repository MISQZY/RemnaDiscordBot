-- CreateTable
CREATE TABLE "StarboardEntry" (
    "messageId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "starboardMessageId" TEXT,
    "stars" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StarboardEntry_pkey" PRIMARY KEY ("messageId")
);

-- CreateIndex
CREATE INDEX "StarboardEntry_guildId_stars_idx" ON "StarboardEntry"("guildId", "stars");

