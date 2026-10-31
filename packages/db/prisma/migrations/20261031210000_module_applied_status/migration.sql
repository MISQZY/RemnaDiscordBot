-- AlterTable
ALTER TABLE "GuildModuleConfig" ADD COLUMN     "applied" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "GuildModuleConfig" ADD COLUMN     "applyError" TEXT;
