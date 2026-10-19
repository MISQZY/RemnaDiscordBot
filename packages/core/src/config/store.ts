import type { Prisma, PrismaClient } from '@bot/db';

/** A module config as stored in the database (before validation). */
export interface StoredConfig {
  enabled: boolean;
  config: unknown;
  version: number;
  /** ISO time of the last change — the basis of the API ETag. */
  updatedAt: string;
}

export type ConfigWrite = Omit<StoredConfig, 'updatedAt'>;

export interface ConfigStore {
  find(guildId: string, moduleId: string): Promise<StoredConfig | null>;
  save(guildId: string, moduleId: string, value: ConfigWrite, updatedBy?: string): Promise<StoredConfig>;
}

const SELECT = { enabled: true, config: true, version: true, updatedAt: true } as const;

function toStored(row: { enabled: boolean; config: unknown; version: number; updatedAt: Date }): StoredConfig {
  return { ...row, updatedAt: row.updatedAt.toISOString() };
}

export class PrismaConfigStore implements ConfigStore {
  constructor(private readonly db: PrismaClient) {}

  async find(guildId: string, moduleId: string): Promise<StoredConfig | null> {
    const row = await this.db.guildModuleConfig.findUnique({
      where: { guildId_moduleId: { guildId, moduleId } },
      select: SELECT,
    });
    return row && toStored(row);
  }

  async save(guildId: string, moduleId: string, value: ConfigWrite, updatedBy?: string): Promise<StoredConfig> {
    const data = {
      enabled: value.enabled,
      config: value.config as Prisma.InputJsonValue,
      version: value.version,
      updatedBy: updatedBy ?? null,
    };
    const row = await this.db.guildModuleConfig.upsert({
      where: { guildId_moduleId: { guildId, moduleId } },
      update: data,
      create: {
        ...data,
        moduleId,
        guild: { connectOrCreate: { where: { id: guildId }, create: { id: guildId } } },
      },
      select: SELECT,
    });
    return toStored(row);
  }
}
