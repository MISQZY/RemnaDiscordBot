-- AlterTable
ALTER TABLE "ScheduledAction" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "key" TEXT,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "lockedUntil" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledAction_key_key" ON "ScheduledAction"("key");

