import { defineModule, EntityChecker } from '@bot/core';
import { GatewayIntentBits } from 'discord.js';
import { autorolesApi } from './api.js';
import { onMemberJoin, onMemberLeave, panelComponent } from './bot.js';
import { AutorolesConfig, defaultAutorolesConfig } from './config.js';
import { assignJoinRoles } from './jobs.js';
import { locales } from './locales.js';
import { COMPONENT_PREFIX } from './panel.js';

export { AutorolesConfig, Panel, PanelInput } from './config.js';

/** Роли при входе, восстановление ролей при возвращении, панели самостоятельного выбора ролей. */
export default defineModule({
  id: 'autoroles',
  configSchema: AutorolesConfig,
  defaultConfig: defaultAutorolesConfig,
  configVersion: 1,
  locales,
  validateConfig: (config, guild) =>
    new EntityChecker(guild)
      .roles(config.joinRoles.humans, ['joinRoles', 'humans'], { assignable: true })
      .roles(config.joinRoles.bots, ['joinRoles', 'bots'], { assignable: true })
      .roles(config.persistence.roleIds, ['persistence', 'roleIds']).issues,
  bot: {
    // Вход и выход участников — привилегированный intent Server Members.
    intents: [GatewayIntentBits.GuildMembers],
    events: {
      guildMemberAdd: onMemberJoin,
      guildMemberRemove: onMemberLeave,
    },
    components: { [COMPONENT_PREFIX]: panelComponent },
  },
  jobs: { assignJoinRoles },
  api: autorolesApi,
});
