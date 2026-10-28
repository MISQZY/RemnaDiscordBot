-- AlterTable
ALTER TABLE "NotificationSource" ADD COLUMN     "failures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "lastSuccessAt" TIMESTAMP(3),
ADD COLUMN     "nextCheckAt" TIMESTAMP(3),
ADD COLUMN     "seenIds" JSONB;

-- Checked sources keep their last item as the only seen one; a checked source without one has seen nothing yet.
UPDATE "NotificationSource"
SET "seenIds" = CASE WHEN "lastItemId" IS NULL THEN '[]'::jsonb ELSE jsonb_build_array("lastItemId") END,
    "lastSuccessAt" = "lastCheckedAt"
WHERE "lastCheckedAt" IS NOT NULL;

ALTER TABLE "NotificationSource" DROP COLUMN "lastItemId";

-- AlterTable
ALTER TABLE "NotificationSubscription" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "deliveryError" TEXT;
