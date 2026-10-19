import { defineModule, EntityChecker } from '@bot/core';
import { GatewayIntentBits } from 'discord.js';
import { autorolesApi } from './api.js';
import { onMemberJoin, onMemberLeave, panelComponent } from './bot.js';
import { autorolesCommand } from './commands.js';
import { AutorolesConfig, defaultAutorolesConfig } from './config.js';
import { assignJoinRoles } from './jobs.js';
import { locales } from './locales.js';
import { COMPONENT_PREFIX } from './panel.js';

export { AutorolesConfig, Panel, PanelInput } from './config.js';

/** Join roles, role restore for returning members, self-assignable role panels. */
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
    // Member joins and leaves require the privileged Server Members intent.
    intents: [GatewayIntentBits.GuildMembers],
    events: {
      guildMemberAdd: onMemberJoin,
      guildMemberRemove: onMemberLeave,
    },
    commands: [autorolesCommand],
    components: { [COMPONENT_PREFIX]: panelComponent },
  },
  jobs: { assignJoinRoles },
  api: autorolesApi,
});
