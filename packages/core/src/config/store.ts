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

/** The config changed after the caller read it. */
export class ConfigConflictError extends Error {
  constructor() { super('Module config changed; reload and try again'); }
}

export interface ConfigStore {
  find(guildId: string, moduleId: string): Promise<StoredConfig | null>;
  save(guildId: string, moduleId: string, value: ConfigWrite, updatedBy?: string, expectedUpdatedAt?: string | null): Promise<StoredConfig>;
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

  async save(guildId: string, moduleId: string, value: ConfigWrite, updatedBy?: string, expectedUpdatedAt?: string | null): Promise<StoredConfig> {
    const data = {
      enabled: value.enabled,
      config: value.config as Prisma.InputJsonValue,
      version: value.version,
      updatedBy: updatedBy ?? null,
    };
    if (expectedUpdatedAt !== undefined) {
      try {
        return await this.db.$transaction(async (tx) => {
          // Millisecond timestamps are ETags: even two saves in one millisecond must differ.
          const updatedAt = new Date(Math.max(Date.now(), expectedUpdatedAt === null ? 0 : Date.parse(expectedUpdatedAt) + 1));
          if (expectedUpdatedAt === null) {
            return toStored(await tx.guildModuleConfig.create({
              data: { ...data, updatedAt, moduleId, guild: { connectOrCreate: { where: { id: guildId }, create: { id: guildId } } } },
              select: SELECT,
            }));
          }
          const { count } = await tx.guildModuleConfig.updateMany({
            where: { guildId, moduleId, updatedAt: new Date(expectedUpdatedAt) },
            data: { ...data, updatedAt },
          });
          if (count !== 1) throw new ConfigConflictError();
          return toStored(await tx.guildModuleConfig.findUniqueOrThrow({ where: { guildId_moduleId: { guildId, moduleId } }, select: SELECT }));
        });
      } catch (err) {
        // A concurrent first save wins the unique guild/module key.
        if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'P2002') throw new ConfigConflictError();
        throw err;
      }
    }
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
