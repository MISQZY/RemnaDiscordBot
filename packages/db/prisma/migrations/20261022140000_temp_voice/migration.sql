-- CreateTable
CREATE TABLE "TempVoiceChannel" (
    "channelId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TempVoiceChannel_pkey" PRIMARY KEY ("channelId")
);

-- CreateIndex
CREATE INDEX "TempVoiceChannel_guildId_idx" ON "TempVoiceChannel"("guildId");

