-- CreateTable
CREATE TABLE "GuildVip" (
    "guildId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "GuildVip_pkey" PRIMARY KEY ("guildId")
);

-- CreateTable
CREATE TABLE "VipSettings" (
    "id" TEXT NOT NULL,
    "modules" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VipSettings_pkey" PRIMARY KEY ("id")
);
