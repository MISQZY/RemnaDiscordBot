-- CreateTable
CREATE TABLE "VerificationPanel" (
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationPanel_pkey" PRIMARY KEY ("guildId")
);

