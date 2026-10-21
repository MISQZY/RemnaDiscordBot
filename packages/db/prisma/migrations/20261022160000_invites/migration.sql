-- CreateTable
CREATE TABLE "MemberInvite" (
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "inviterId" TEXT,
    "code" TEXT,
    "fake" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "MemberInvite_pkey" PRIMARY KEY ("guildId","userId")
);

-- CreateIndex
CREATE INDEX "MemberInvite_guildId_inviterId_idx" ON "MemberInvite"("guildId", "inviterId");

