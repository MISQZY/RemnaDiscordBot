import { VipFeature, type VipState } from '@bot/contracts';
import type { Prisma, PrismaClient } from '@bot/db';
import { z } from 'zod';

export interface VipStore {
  load(): Promise<VipState>;
  /** Replaces the whole state: guilds not in it lose VIP. */
  replace(state: VipState): Promise<boolean>;
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
    // A feature the bot no longer knows is dropped, not the whole list.
    const features = z.array(z.unknown()).safeParse(settings?.features);
    return {
      modules: modules.success ? modules.data : [],
      features: features.success ? features.data.filter((f): f is VipFeature => VipFeature.safeParse(f).success) : [],
      guilds: guilds.map((g) => ({ guildId: g.guildId, expiresAt: g.expiresAt?.toISOString() ?? null })),
    };
  }

  async replace(state: VipState): Promise<boolean> {
    const modules = state.modules as Prisma.InputJsonValue;
    const features = state.features as Prisma.InputJsonValue;
    return this.db.$transaction(async (tx) => {
      // Every replacement writes this row first, serializing the read and diff across API replicas.
      const current = await tx.vipSettings.upsert({
        where: { id: SETTINGS_ID },
        create: { id: SETTINGS_ID },
        update: { revision: { increment: 0 } },
      });
      if ((current.revision > 0 && state.revision === undefined) || (state.revision !== undefined && state.revision <= current.revision)) return false;
      await tx.vipSettings.update({ where: { id: SETTINGS_ID }, data: { modules, features, ...(state.revision !== undefined && { revision: state.revision }) } });
      const currentGuilds = await tx.guildVip.findMany();
      const currentMap = new Map(currentGuilds.map((g) => [g.guildId, g.expiresAt?.getTime() ?? null]));
      const targetGuildIds = new Set(state.guilds.map((g) => g.guildId));
      const toDelete = currentGuilds.filter((g) => !targetGuildIds.has(g.guildId)).map((g) => g.guildId);
      const toUpsert = state.guilds.filter((g) => {
        const targetTime = g.expiresAt ? new Date(g.expiresAt).getTime() : null;
        return !currentMap.has(g.guildId) || currentMap.get(g.guildId) !== targetTime;
      });
      if (toDelete.length > 0) {
        await tx.guildVip.deleteMany({ where: { guildId: { in: toDelete } } });
      }
      for (const g of toUpsert) {
        const expiresAt = g.expiresAt ? new Date(g.expiresAt) : null;
        await tx.guildVip.upsert({
          where: { guildId: g.guildId },
          create: { guildId: g.guildId, expiresAt },
          update: { expiresAt },
        });
      }
      return true;
    });
  }
}
