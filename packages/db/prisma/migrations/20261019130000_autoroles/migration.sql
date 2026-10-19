-- CreateTable
CREATE TABLE "RolePanel" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "kind" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "maxRoles" INTEGER,
    "message" JSONB NOT NULL,
    "items" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RolePanel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberRoleBackup" (
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleIds" JSONB NOT NULL,
    "savedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberRoleBackup_pkey" PRIMARY KEY ("guildId","userId")
);

-- CreateIndex
CREATE INDEX "RolePanel_guildId_idx" ON "RolePanel"("guildId");

