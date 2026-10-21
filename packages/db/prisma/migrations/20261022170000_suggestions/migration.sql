-- CreateTable
CREATE TABLE "Suggestion" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewerId" TEXT,
    "response" TEXT,
    "upvotes" INTEGER NOT NULL DEFAULT 0,
    "downvotes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Suggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuggestionVote" (
    "suggestionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "SuggestionVote_pkey" PRIMARY KEY ("suggestionId","userId")
);

-- CreateTable
CREATE TABLE "SuggestionCounter" (
    "guildId" TEXT NOT NULL,
    "last" INTEGER NOT NULL,

    CONSTRAINT "SuggestionCounter_pkey" PRIMARY KEY ("guildId")
);

-- CreateIndex
CREATE INDEX "Suggestion_guildId_status_idx" ON "Suggestion"("guildId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Suggestion_guildId_number_key" ON "Suggestion"("guildId", "number");

