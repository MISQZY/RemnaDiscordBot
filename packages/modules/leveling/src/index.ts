import { defineModule, EntityChecker } from '@bot/core';
import { GatewayIntentBits } from 'discord.js';
import { levelingApi, levelingPublicApi } from './api.js';
import { onMessage } from './bot.js';
import { commands, COMPONENT_PREFIX, leaderboardPager } from './commands.js';
import { defaultLevelingConfig, LevelingConfig } from './config.js';
import { locales } from './locales.js';

export { LeaderboardEntry, LevelingConfig } from './config.js';
export { LevelingService } from './service.js';

/** Message XP, levels, reward roles and a leaderboard. */
export default defineModule({
  id: 'leveling',
  configSchema: LevelingConfig,
  defaultConfig: defaultLevelingConfig,
  configVersion: 1,
  locales,
  localizeDefaults: (defaults, t) => ({
    ...defaults,
    announcement: { ...defaults.announcement, message: { content: t('defaults.levelUp') } },
  }),
  validateConfig: (config, guild) => {
    const checker = new EntityChecker(guild)
      .textChannel(config.announcement.channelId, ['announcement', 'channelId'])
      .channels(config.ignoredChannelIds, ['ignoredChannelIds'])
      .roles(config.ignoredRoleIds, ['ignoredRoleIds']);
    config.rewards.forEach((reward, i) => checker.assignableRole(reward.roleId, ['rewards', i, 'roleId']));
    config.multipliers.forEach((m, i) =>
      m.type === 'role' ? checker.role(m.id, ['multipliers', i, 'id']) : checker.channels([m.id], ['multipliers', i, 'id']),
    );
    return checker.issues;
  },
  bot: {
    // Only the author and channel of a message are needed — no Message Content intent.
    intents: [GatewayIntentBits.GuildMessages],
    commands,
    events: { messageCreate: onMessage },
    components: { [COMPONENT_PREFIX]: leaderboardPager },
  },
  api: levelingApi,
  publicApi: levelingPublicApi,
});
