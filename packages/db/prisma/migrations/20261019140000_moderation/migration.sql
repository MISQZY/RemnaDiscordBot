-- CreateTable
CREATE TABLE "ModCase" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "moderatorId" TEXT NOT NULL,
    "reason" TEXT,
    "durationSec" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "revokeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModCaseCounter" (
    "guildId" TEXT NOT NULL,
    "last" INTEGER NOT NULL,

    CONSTRAINT "ModCaseCounter_pkey" PRIMARY KEY ("guildId")
);

-- CreateIndex
CREATE INDEX "ModCase_guildId_targetId_type_idx" ON "ModCase"("guildId", "targetId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "ModCase_guildId_number_key" ON "ModCase"("guildId", "number");

