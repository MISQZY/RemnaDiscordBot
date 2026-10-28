import type { ModuleServices } from '@bot/core';
import { ApiSettings, sealSettings } from './api-settings.js';
import type { NotificationsConfig } from './config.js';
import { secrets } from './secrets.js';

/**
 * Seals again with the first key what is plain or sealed with a later one (`SECRETS_KEY_OLD`, the bot token): after a
 * new SECRETS_KEY, once this has run the old key can go. What no key opens is left for its manager to enter again.
 */
export async function resealSecrets(ctx: ModuleServices<NotificationsConfig>, box = secrets()): Promise<number> {
  let resealed = 0;
  const reseal = (value: string) => {
    try {
      return box.reseal(value);
    } catch {
      return null;
    }
  };

  const sources = await ctx.db.notificationSource.findMany({ where: { provider: 'api' }, select: { id: true, settings: true } });
  for (const source of sources) {
    const stored = source.settings as { url?: unknown; headers?: { value?: unknown }[] } | null;
    const values = [stored?.url, ...(stored?.headers ?? []).map((h) => h.value)].filter((v): v is string => typeof v === 'string');
    if (!values.some((v) => reseal(v) !== null)) continue;
    // All of them opened and checked, then sealed anew together; a part no key opens leaves the settings as they are.
    try {
      const opened = ApiSettings.parse({
        ...stored,
        url: box.open(String(stored?.url)),
        headers: (stored?.headers ?? []).map((h) => ({ ...h, value: box.open(String(h.value)) })),
      });
      await ctx.db.notificationSource.update({ where: { id: source.id }, data: { settings: sealSettings(opened, box) } });
      resealed++;
    } catch (err) {
      ctx.logger.warn({ err, sourceId: source.id }, 'API source settings could not be resealed');
    }
  }

  const hooks = await ctx.db.notificationSubscription.findMany({ where: { webhookToken: { not: null } }, select: { id: true, webhookToken: true } });
  for (const hook of hooks) {
    const next = reseal(hook.webhookToken!);
    if (!next) continue;
    await ctx.db.notificationSubscription.update({ where: { id: hook.id }, data: { webhookToken: next } });
    resealed++;
  }
  if (resealed > 0) ctx.logger.info({ resealed }, 'Notification secrets resealed with the current key');
  return resealed;
}
