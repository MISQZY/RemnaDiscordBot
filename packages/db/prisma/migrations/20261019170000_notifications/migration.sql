-- CreateTable
CREATE TABLE "NotificationSource" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lastItemId" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationSubscription" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "mentionRoleId" TEXT,
    "message" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationSource_provider_externalId_key" ON "NotificationSource"("provider", "externalId");

-- CreateIndex
CREATE INDEX "NotificationSubscription_sourceId_idx" ON "NotificationSubscription"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationSubscription_guildId_sourceId_key" ON "NotificationSubscription"("guildId", "sourceId");

-- AddForeignKey
ALTER TABLE "NotificationSubscription" ADD CONSTRAINT "NotificationSubscription_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "NotificationSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

