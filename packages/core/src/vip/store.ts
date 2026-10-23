import type { VipState } from '@bot/contracts';
import type { Prisma, PrismaClient } from '@bot/db';
import { z } from 'zod';

export interface VipStore {
  load(): Promise<VipState>;
  /** Replaces the whole state: guilds not in it lose VIP. */
  replace(state: VipState): Promise<void>;
}

const SETTINGS_ID = 'default';

export class PrismaVipStore implements VipStore {
  constructor(private readonly db: PrismaClient) {}

  async load(): Promise<VipState> {
    const [settings, guilds] = await Promise.all([
      this.db.vipSettings.findUnique({ where: { id: SETTINGS_ID } }),
      this.db.guildVip.findMany(),
    ]);
    const modules = z.array(z.string()).safeParse(settings?.modules);
    return {
      modules: modules.success ? modules.data : [],
      guilds: guilds.map((g) => ({ guildId: g.guildId, expiresAt: g.expiresAt?.toISOString() ?? null })),
    };
  }

  async replace(state: VipState): Promise<void> {
    const modules = state.modules as Prisma.InputJsonValue;
    await this.db.$transaction([
      this.db.vipSettings.upsert({ where: { id: SETTINGS_ID }, create: { id: SETTINGS_ID, modules }, update: { modules } }),
      this.db.guildVip.deleteMany(),
      this.db.guildVip.createMany({
        data: state.guilds.map((g) => ({ guildId: g.guildId, expiresAt: g.expiresAt ? new Date(g.expiresAt) : null })),
      }),
    ]);
  }
}
