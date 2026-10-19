import type { Prisma, PrismaClient } from '@bot/db';

/** Конфиг модуля в том виде, в каком он лежит в БД (до валидации). */
export interface StoredConfig {
  enabled: boolean;
  config: unknown;
  version: number;
}

export interface ConfigStore {
  find(guildId: string, moduleId: string): Promise<StoredConfig | null>;
  save(guildId: string, moduleId: string, value: StoredConfig, updatedBy?: string): Promise<void>;
}

export class PrismaConfigStore implements ConfigStore {
  constructor(private readonly db: PrismaClient) {}

  async find(guildId: string, moduleId: string): Promise<StoredConfig | null> {
    const row = await this.db.guildModuleConfig.findUnique({
      where: { guildId_moduleId: { guildId, moduleId } },
      select: { enabled: true, config: true, version: true },
    });
    return row;
  }

  async save(guildId: string, moduleId: string, value: StoredConfig, updatedBy?: string): Promise<void> {
    const data = {
      enabled: value.enabled,
      config: value.config as Prisma.InputJsonValue,
      version: value.version,
      updatedBy: updatedBy ?? null,
    };
    await this.db.guildModuleConfig.upsert({
      where: { guildId_moduleId: { guildId, moduleId } },
      update: data,
      create: {
        ...data,
        moduleId,
        guild: { connectOrCreate: { where: { id: guildId }, create: { id: guildId } } },
      },
    });
  }
}
