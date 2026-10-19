-- CreateTable
CREATE TABLE "MemberLevel" (
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 0,
    "messages" INTEGER NOT NULL DEFAULT 0,
    "username" TEXT,
    "avatar" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberLevel_pkey" PRIMARY KEY ("guildId","userId")
);

-- CreateIndex
CREATE INDEX "MemberLevel_guildId_xp_idx" ON "MemberLevel"("guildId", "xp");

