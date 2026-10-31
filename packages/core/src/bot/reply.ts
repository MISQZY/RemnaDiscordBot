import { MessageFlags, type InteractionReplyOptions } from 'discord.js';

export interface Repliable {
  reply(options: InteractionReplyOptions): Promise<unknown>;
}

/** Ephemeral reply that suppresses mentions. */
export function ephemeralReply(
  interaction: Repliable,
  content: string,
  extra?: Omit<InteractionReplyOptions, 'content' | 'flags'>,
): Promise<unknown> {
  return interaction.reply({
    content,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
    ...extra,
  });
}
