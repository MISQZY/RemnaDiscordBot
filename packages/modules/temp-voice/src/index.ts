import { defineModule } from '@bot/core';
import { GatewayIntentBits } from 'discord.js';
import { onReady, onVoiceLeave, onVoiceState, PREFIX, tempVoiceComponent } from './bot.js';
import { voiceCommand } from './commands.js';
import { defaultTempVoiceConfig, TempVoiceConfig } from './config.js';
import { locales } from './locales.js';

export { TempVoiceConfig } from './config.js';

const VOICE = [2, 13];
const CATEGORY = 4;

/** Join a creator channel — get your own voice channel, gone once everyone leaves. */
export default defineModule({
  id: 'temp-voice',
  configSchema: TempVoiceConfig,
  defaultConfig: defaultTempVoiceConfig,
  configVersion: 1,
  locales,
  validateConfig: (config, guild) => {
    const issues: { path: (string | number)[]; message: string }[] = [];
    const byId = new Map(guild.channels.map((c) => [c.id, c]));
    config.creators.forEach((creator, i) => {
      const lobby = byId.get(creator.channelId);
      if (!lobby || !VOICE.includes(lobby.type)) issues.push({ path: ['creators', i, 'channelId'], message: 'Not a voice channel' });
      if (creator.categoryId && byId.get(creator.categoryId)?.type !== CATEGORY) issues.push({ path: ['creators', i, 'categoryId'], message: 'Not a category' });
    });
    return issues;
  },
  bot: {
    intents: [GatewayIntentBits.GuildVoiceStates],
    commands: [voiceCommand],
    components: { [PREFIX]: tempVoiceComponent },
    events: { voiceStateUpdate: onVoiceState },
    // Temp channels are cleaned up whether or not the module is on: switching it off must not leave them behind.
    housekeeping: {
      voiceStateUpdate: onVoiceLeave,
      clientReady: onReady,
      channelDelete: async (ctx, channel) => void (await ctx.db.tempVoiceChannel.deleteMany({ where: { channelId: channel.id } })),
    },
  },
});
