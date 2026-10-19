import { Guild } from 'discord.js';

/** Находит ID гильдии в аргументах gateway-события (message, member, channel, guild…). */
export function extractGuildId(args: readonly unknown[]): string | null {
  for (const arg of args) {
    if (arg instanceof Guild) return arg.id;
    if (typeof arg !== 'object' || arg === null) continue;

    const candidate = arg as { guildId?: unknown; guild?: { id?: unknown } | null };
    if (typeof candidate.guildId === 'string') return candidate.guildId;
    if (typeof candidate.guild?.id === 'string') return candidate.guild.id;
  }
  return null;
}
