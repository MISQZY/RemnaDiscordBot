import type { CoreServices } from '@bot/core';
import type { Reminder } from '@bot/db';
import { Routes } from 'discord.js';
import { reminderKey } from './service.js';

type Services = Pick<CoreServices, 'db' | 'rest' | 'scheduler' | 'logger' | 'i18n' | 'guildLocales'>;

export async function createReminder(
  services: Services,
  input: { guildId: string; channelId: string; userId: string; text: string; dm: boolean; runAt: Date },
): Promise<Reminder> {
  const reminder = await services.db.reminder.create({ data: input });
  await services.scheduler.schedule({ guildId: input.guildId, moduleId: 'messages', job: 'remind', payload: { id: reminder.id }, runAt: input.runAt, key: reminderKey(reminder.id) });
  return reminder;
}

/** Deletes a member's reminder; false — there is no such reminder of theirs. */
export async function deleteReminder(services: Services, guildId: string, userId: string, id: string): Promise<boolean> {
  const { count } = await services.db.reminder.deleteMany({ where: { id, guildId, userId } });
  if (count > 0) await services.scheduler.cancel(reminderKey(id));
  return count > 0;
}

/** The reminder is due: in the channel it was set in, or in DMs. */
export async function sendReminder(services: Services, id: string): Promise<void> {
  const { db, rest, logger, i18n, guildLocales } = services;
  const reminder = await db.reminder.findUnique({ where: { id } });
  if (!reminder) return;
  const locale = await guildLocales.get(reminder.guildId);
  const t = (key: string, vars: Record<string, string | number>) => i18n.t(locale, key, vars);
  const when = `<t:${Math.floor(reminder.createdAt.getTime() / 1000)}:R>`;
  try {
    let channelId = reminder.channelId;
    if (reminder.dm) channelId = ((await rest.post(Routes.userChannels(), { body: { recipient_id: reminder.userId } })) as { id: string }).id;
    await rest.post(Routes.channelMessages(channelId), {
      body: { content: t('messages.remind.due', { user: `<@${reminder.userId}>`, text: reminder.text, when }), allowed_mentions: { users: [reminder.userId] } },
    });
  } catch (err) {
    logger.debug({ err, id }, 'Reminder not delivered');
  }
  await db.reminder.delete({ where: { id } });
}
