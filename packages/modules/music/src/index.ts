import { defineModule, EntityChecker } from '@bot/core';
import { GatewayIntentBits } from 'discord.js';
import { musicApi } from './api.js';
import { buttons, commands, runtime } from './commands.js';
import { defaultMusicConfig, MusicConfig } from './config.js';
import { parseLavalinkNodes } from './format.js';
import { COMPONENT_PREFIX } from './messages.js';
import { locales } from './locales.js';
import { MusicService } from './service.js';

export { MusicConfig } from './config.js';
export { ControlAction, PlayerState, TrackView } from './state.js';

/** Music through a Lavalink node: queue, player buttons, DJ roles and dashboard control. */
export default defineModule({
  id: 'music',
  configSchema: MusicConfig,
  defaultConfig: defaultMusicConfig,
  configVersion: 1,
  locales,
  validateConfig: (config, guild) =>
    new EntityChecker(guild).roles(config.djRoleIds, ['djRoleIds']).channels(config.allowedVoiceChannelIds, ['allowedVoiceChannelIds'])
      .issues,
  bot: {
    intents: [GatewayIntentBits.GuildVoiceStates],
    commands,
    components: { [COMPONENT_PREFIX]: buttons },
    events: {
      voiceStateUpdate: (_ctx, oldState, newState) => runtime.service?.onVoiceStateUpdate(oldState, newState),
    },
    async setup(ctx) {
      const nodes = parseLavalinkNodes(process.env.LAVALINK_NODES);
      if (nodes.length === 0) {
        ctx.logger.info('LAVALINK_NODES is not set: music commands answer that music is unavailable');
        return;
      }
      const service = new MusicService(ctx, nodes);
      runtime.service = service;
      await service.start();
      return async () => {
        await service.stop();
        runtime.service = null;
      };
    },
  },
  api: musicApi,
});
