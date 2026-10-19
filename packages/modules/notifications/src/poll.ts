import { MessageTemplate } from '@bot/contracts';
import type { ModuleServices } from '@bot/core';
import { renderMessage, toRestMessage } from '@bot/templates';
import { Routes } from 'discord.js';
import type { NotificationsConfig } from './config.js';
import type { Provider } from './providers.js';

/** Тело анонса; упоминается только роль подписки, а не любые роли из шаблона. */
export function announcementBody(
  subscription: { message: unknown; mentionRoleId: string | null },
  vars: Record<string, string | number>,
) {
  const { content, embeds, allowed_mentions } = toRestMessage(renderMessage(MessageTemplate.parse(subscription.message), vars));
  const role = subscription.mentionRoleId;
  return {
    content: role ? `<@&${role}> ${content ?? ''}`.trim() : content,
    embeds,
    allowed_mentions: {
      parse: allowed_mentions.parse.filter((p) => p !== 'roles'),
      ...(role ? { roles: [role] } : {}),
    },
  };
}

/** Сколько новых элементов объявлять за проверку — защита от лавины после простоя. */
const MAX_ITEMS_PER_CHECK = 3;

/**
 * Проверяет источники провайдера, у которых есть включённые подписки, и рассылает анонсы.
 * Первая проверка источника только запоминает последний элемент.
 */
export async function pollProvider(ctx: ModuleServices<NotificationsConfig>, provider: Provider): Promise<number> {
  const sources = await ctx.db.notificationSource.findMany({
    where: { provider: provider.id, subscriptions: { some: { enabled: true } } },
    include: { subscriptions: { where: { enabled: true } } },
  });
  if (sources.length === 0) return 0;

  const latest = await provider.latest(sources.map((s) => s.externalId));
  let announced = 0;

  for (const source of sources) {
    const items = latest.get(source.externalId) ?? [];
    const newestId = items[0]?.id ?? source.lastItemId;

    let fresh: typeof items = [];
    if (source.lastItemId !== null) {
      const seenAt = items.findIndex((item) => item.id === source.lastItemId);
      fresh = (seenAt === -1 ? items : items.slice(0, seenAt)).slice(0, MAX_ITEMS_PER_CHECK).reverse();
    }

    for (const item of fresh) {
      for (const subscription of source.subscriptions) {
        if (!(await ctx.config.isEnabled(subscription.guildId, 'notifications'))) continue;
        const body = announcementBody(subscription, item.vars);
        try {
          await ctx.rest.post(Routes.channelMessages(subscription.channelId), { body });
          announced++;
        } catch (err) {
          ctx.logger.warn({ err, subscriptionId: subscription.id }, 'Notification not delivered');
        }
      }
    }

    await ctx.db.notificationSource.update({
      where: { id: source.id },
      data: { lastItemId: newestId, lastCheckedAt: new Date() },
    });
  }
  return announced;
}
