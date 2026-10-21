-- CreateTable
CREATE TABLE "ChannelLockdown" (
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "addedDeny" TEXT NOT NULL,
    "removedAllow" TEXT NOT NULL,
    "hadOverwrite" BOOLEAN NOT NULL,
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelLockdown_pkey" PRIMARY KEY ("guildId","channelId")
);

