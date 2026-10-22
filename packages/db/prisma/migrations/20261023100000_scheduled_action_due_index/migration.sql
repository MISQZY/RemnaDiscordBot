-- Due jobs are looked up by "doneAt" IS NULL and taken in "runAt" order: the old (runAt, doneAt) index walked
-- every done job kept for history first.
DROP INDEX "ScheduledAction_runAt_doneAt_idx";

-- CreateIndex
CREATE INDEX "ScheduledAction_doneAt_runAt_idx" ON "ScheduledAction"("doneAt", "runAt");
