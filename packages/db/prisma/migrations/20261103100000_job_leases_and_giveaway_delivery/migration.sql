ALTER TABLE "ScheduledAction" ADD COLUMN "lockToken" TEXT;
ALTER TABLE "Giveaway" ADD COLUMN "drawVersion" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "GiveawayDelivery" (
    "id" TEXT NOT NULL,
    "giveawayId" TEXT NOT NULL,
    "winnerIds" JSONB NOT NULL,
    "reroll" BOOLEAN NOT NULL DEFAULT false,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GiveawayDelivery_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GiveawayDelivery_giveawayId_fkey" FOREIGN KEY ("giveawayId") REFERENCES "Giveaway"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "GiveawayDelivery_giveawayId_idx" ON "GiveawayDelivery"("giveawayId");
