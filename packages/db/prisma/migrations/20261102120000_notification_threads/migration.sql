ALTER TABLE "NotificationSubscription" ADD COLUMN "deliveryMode" TEXT NOT NULL DEFAULT 'channel';
ALTER TABLE "NotificationSubscription" ADD COLUMN "threadId" TEXT;
