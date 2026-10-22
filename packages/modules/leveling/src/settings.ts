import { defineCommand, type InteractionContext } from '@bot/core';
import { isElevatedRole, memberOutranksRole } from '@bot/discord';
import {
  channelMention,
  ChannelType,
  EmbedBuilder,
  GuildMember,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  roleMention,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildBasedChannel,
  type Role,
} from 'discord.js';
import { syncRewards } from './bot.js';
import { LevelingConfig } from './config.js';
import { LevelingService } from './service.js';

type Ctx = InteractionContext<LevelingConfig>;

const reply = (interaction: ChatInputCommandInteraction, content: string) =>
  interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

/** Saves a changed config; false — the change breaks the schema (the reply is already sent). */
async function updateConfig(ctx: Ctx, interaction: ChatInputCommandInteraction, change: (config: LevelingConfig) => LevelingConfig) {
  const guildId = interaction.guildId!;
  const next = LevelingConfig.safeParse(change(structuredClone(await ctx.getConfig(guildId))));
  if (!next.success) {
    await reply(interaction, ctx.t('leveling.settings.invalid', { error: next.error.issues[0]?.message ?? '' }));
    return false;
  }
  await ctx.config.update(guildId, ctx.moduleId, { config: next.data }, interaction.user.id);
  return true;
}

/** Why the bot cannot grant the role, or why the invoker may not pick it; `null` — fine. */
function roleProblem(ctx: Ctx, interaction: ChatInputCommandInteraction, role: Role): string | null {
  if (role.id === role.guild.id || role.managed) return ctx.t('leveling.settings.roleNotAssignable', { role: role.name });
  if (isElevatedRole(role)) return ctx.t('core.roleElevated', { role: role.name });
  if (!role.editable) return ctx.t('leveling.settings.roleTooHigh', { role: role.name });
  if (!interaction.inCachedGuild() || !memberOutranksRole(interaction.member, role)) return ctx.t('core.roleAboveYou', { role: role.name });
  return null;
}

const textChannelTypes = [ChannelType.GuildText, ChannelType.GuildAnnouncement] as const;

export const levels = defineCommand<LevelingConfig>({
  data: new SlashCommandBuilder()
    .setName('levels')
    .setDescription('Configure leveling')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('show').setDescription('Show leveling settings'))
    .addSubcommand((s) =>
      s
        .setName('xp')
        .setDescription('XP per message and the cooldown')
        .addIntegerOption((o) => o.setName('min').setDescription('Minimum XP').setRequired(true).setMinValue(1).setMaxValue(100))
        .addIntegerOption((o) => o.setName('max').setDescription('Maximum XP').setRequired(true).setMinValue(1).setMaxValue(100))
        .addIntegerOption((o) => o.setName('cooldown').setDescription('Seconds between rewarded messages').setMinValue(0).setMaxValue(3600)),
    )
    .addSubcommand((s) =>
      s
        .setName('announce')
        .setDescription('Where to announce level-ups')
        .addStringOption((o) =>
          o
            .setName('mode')
            .setDescription('Where')
            .setRequired(true)
            .addChoices(
              { name: 'Off', value: 'off' },
              { name: 'Same channel', value: 'current' },
              { name: 'Chosen channel', value: 'channel' },
              { name: 'Direct message', value: 'dm' },
            ),
        )
        .addChannelOption((o) => o.setName('channel').setDescription('Channel for the "Chosen channel" mode').addChannelTypes(...textChannelTypes))
        .addStringOption((o) => o.setName('message').setDescription('Text: {user.mention}, {level}, {xp}…').setMaxLength(2000)),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('rewards')
        .setDescription('Roles for reaching levels')
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('Grant a role at a level')
            .addIntegerOption((o) => o.setName('level').setDescription('Level').setRequired(true).setMinValue(1).setMaxValue(1000))
            .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)),
        )
        .addSubcommand((s) =>
          s
            .setName('remove')
            .setDescription('Remove the reward of a level')
            .addIntegerOption((o) => o.setName('level').setDescription('Level').setRequired(true).setMinValue(1).setMaxValue(1000)),
        )
        .addSubcommand((s) =>
          s
            .setName('stack')
            .setDescription('Keep the roles of previous levels')
            .addBooleanOption((o) => o.setName('enabled').setDescription('Keep previous rewards').setRequired(true)),
        ),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('ignore')
        .setDescription('Channels and roles that earn no XP')
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('Stop granting XP in a channel or to a role')
            .addChannelOption((o) => o.setName('channel').setDescription('Channel'))
            .addRoleOption((o) => o.setName('role').setDescription('Role')),
        )
        .addSubcommand((s) =>
          s
            .setName('remove')
            .setDescription('Grant XP in a channel or to a role again')
            .addChannelOption((o) => o.setName('channel').setDescription('Channel'))
            .addRoleOption((o) => o.setName('role').setDescription('Role')),
        ),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('multiplier')
        .setDescription('XP multipliers for roles and channels')
        .addSubcommand((s) =>
          s
            .setName('set')
            .setDescription('Multiply XP for a role or in a channel')
            .addNumberOption((o) => o.setName('value').setDescription('Multiplier, e.g. 1.5; 0 — no XP').setRequired(true).setMinValue(0).setMaxValue(10))
            .addRoleOption((o) => o.setName('role').setDescription('Role'))
            .addChannelOption((o) => o.setName('channel').setDescription('Channel')),
        )
        .addSubcommand((s) =>
          s
            .setName('remove')
            .setDescription('Remove a multiplier')
            .addRoleOption((o) => o.setName('role').setDescription('Role'))
            .addChannelOption((o) => o.setName('channel').setDescription('Channel')),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('public')
        .setDescription('Publish the leaderboard on the website')
        .addBooleanOption((o) => o.setName('enabled').setDescription('Public leaderboard').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('reset')
        .setDescription("Reset a member's XP")
        .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),
    ),
  cooldownMs: 2_000,

  async execute(interaction, ctx) {
    const guildId = interaction.guildId!;
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    const none = ctx.t('leveling.settings.none');
    const onOff = (value: boolean) => ctx.t(value ? 'leveling.settings.on' : 'leveling.settings.off');

    if (!group && sub === 'show') {
      const c = await ctx.getConfig(guildId);
      const list = (items: string[]) => (items.length > 0 ? items.join(' ') : none);
      const rewards = [...c.rewards].sort((a, b) => a.level - b.level).map((r) => ctx.t('leveling.settings.reward', { level: r.level, role: roleMention(r.roleId) }));
      const multipliers = c.multipliers.map((m) => `${m.type === 'role' ? roleMention(m.id) : channelMention(m.id)} ×${m.value}`);
      const announce =
        ctx.t(`leveling.settings.announceModes.${c.announcement.mode}`) +
        (c.announcement.mode === 'channel' && c.announcement.channelId ? ` · ${channelMention(c.announcement.channelId)}` : '');
      const embed = new EmbedBuilder().setTitle(ctx.t('leveling.name')).addFields(
        { name: ctx.t('leveling.settings.xp'), value: ctx.t('leveling.settings.xpValue', { min: c.xpPerMessage.min, max: c.xpPerMessage.max, cooldown: c.cooldownSec }) },
        { name: ctx.t('leveling.settings.announce'), value: announce, inline: true },
        { name: ctx.t('leveling.settings.stack'), value: onOff(c.stackRewards), inline: true },
        { name: ctx.t('leveling.settings.public'), value: onOff(c.publicLeaderboard), inline: true },
        { name: ctx.t('leveling.settings.rewards'), value: rewards.join('\n') || none },
        { name: ctx.t('leveling.settings.multipliers'), value: list(multipliers) },
        { name: ctx.t('leveling.settings.ignoredList'), value: list([...c.ignoredChannelIds.map(channelMention), ...c.ignoredRoleIds.map(roleMention)]) },
      );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      return;
    }

    if (!group && sub === 'xp') {
      const min = interaction.options.getInteger('min', true);
      const max = interaction.options.getInteger('max', true);
      const cooldown = interaction.options.getInteger('cooldown');
      if (min > max) return void (await reply(interaction, ctx.t('leveling.settings.minAboveMax')));
      const saved = await updateConfig(ctx, interaction, (c) => ({ ...c, xpPerMessage: { min, max }, cooldownSec: cooldown ?? c.cooldownSec }));
      if (saved) await reply(interaction, ctx.t('leveling.settings.xpSet', { min, max }));
      return;
    }

    if (!group && sub === 'announce') {
      const mode = interaction.options.getString('mode', true) as LevelingConfig['announcement']['mode'];
      const channel = interaction.options.getChannel('channel') as GuildBasedChannel | null;
      const message = interaction.options.getString('message');
      const current = await ctx.getConfig(guildId);
      const channelId = channel?.id ?? current.announcement.channelId;
      if (mode === 'channel' && !channelId) return void (await reply(interaction, ctx.t('leveling.settings.pickChannel')));
      if (mode === 'channel' && channel) {
        const me = channel.guild.members.me;
        if (!me || !channel.permissionsFor(me).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
          return void (await reply(interaction, ctx.t('leveling.settings.noAccess', { channel: channelMention(channel.id) })));
        }
      }
      const saved = await updateConfig(ctx, interaction, (c) => ({
        ...c,
        announcement: { mode, channelId, message: message ? { ...c.announcement.message, content: message } : c.announcement.message },
      }));
      if (saved) await reply(interaction, ctx.t('leveling.settings.announceSet', { mode: ctx.t(`leveling.settings.announceModes.${mode}`) }));
      return;
    }

    if (group === 'rewards') {
      if (sub === 'stack') {
        const enabled = interaction.options.getBoolean('enabled', true);
        if (await updateConfig(ctx, interaction, (c) => ({ ...c, stackRewards: enabled }))) {
          await reply(interaction, ctx.t('leveling.settings.stackSet', { state: onOff(enabled) }));
        }
        return;
      }
      const level = interaction.options.getInteger('level', true);
      if (sub === 'remove') {
        const config = await ctx.getConfig(guildId);
        if (!config.rewards.some((r) => r.level === level)) return void (await reply(interaction, ctx.t('leveling.settings.noReward', { level })));
        if (await updateConfig(ctx, interaction, (c) => ({ ...c, rewards: c.rewards.filter((r) => r.level !== level) }))) {
          await reply(interaction, ctx.t('leveling.settings.rewardRemoved', { level }));
        }
        return;
      }
      const role = interaction.options.getRole('role', true) as Role;
      const problem = roleProblem(ctx, interaction, role);
      if (problem) return void (await reply(interaction, problem));
      const saved = await updateConfig(ctx, interaction, (c) => ({
        ...c,
        rewards: [...c.rewards.filter((r) => r.level !== level && r.roleId !== role.id), { level, roleId: role.id }].sort((a, b) => a.level - b.level),
      }));
      if (saved) await reply(interaction, ctx.t('leveling.settings.rewardSet', { level, role: role.name }));
      return;
    }

    if (group === 'ignore') {
      const channel = interaction.options.getChannel('channel');
      const role = interaction.options.getRole('role');
      if (!channel && !role) return void (await reply(interaction, ctx.t('leveling.settings.pickTarget')));
      const add = sub === 'add';
      const apply = (ids: string[], id: string | undefined, max: number) =>
        !id ? ids : add ? [...new Set([...ids, id])].slice(0, max) : ids.filter((x) => x !== id);
      const saved = await updateConfig(ctx, interaction, (c) => ({
        ...c,
        ignoredChannelIds: apply(c.ignoredChannelIds, channel?.id, 100),
        ignoredRoleIds: apply(c.ignoredRoleIds, role?.id, 50),
      }));
      const targets = [channel && channelMention(channel.id), role && roleMention(role.id)].filter(Boolean).join(', ');
      if (saved) await reply(interaction, ctx.t(add ? 'leveling.settings.ignored' : 'leveling.settings.unignored', { targets }));
      return;
    }

    if (group === 'multiplier') {
      const role = interaction.options.getRole('role');
      const channel = interaction.options.getChannel('channel');
      if ((role ? 1 : 0) + (channel ? 1 : 0) !== 1) return void (await reply(interaction, ctx.t('leveling.settings.pickOne')));
      const target = role ? { type: 'role' as const, id: role.id } : { type: 'channel' as const, id: channel!.id };
      const mention = role ? roleMention(role.id) : channelMention(channel!.id);
      const others = (c: LevelingConfig) => c.multipliers.filter((m) => !(m.type === target.type && m.id === target.id));
      if (sub === 'remove') {
        if (await updateConfig(ctx, interaction, (c) => ({ ...c, multipliers: others(c) }))) {
          await reply(interaction, ctx.t('leveling.settings.multiplierRemoved', { target: mention }));
        }
        return;
      }
      const value = interaction.options.getNumber('value', true);
      if (await updateConfig(ctx, interaction, (c) => ({ ...c, multipliers: [...others(c), { ...target, value }] }))) {
        await reply(interaction, ctx.t('leveling.settings.multiplierSet', { target: mention, value }));
      }
      return;
    }

    if (sub === 'public') {
      const enabled = interaction.options.getBoolean('enabled', true);
      if (await updateConfig(ctx, interaction, (c) => ({ ...c, publicLeaderboard: enabled }))) {
        await reply(interaction, ctx.t('leveling.settings.publicSet', { state: onOff(enabled) }));
      }
      return;
    }

    if (sub === 'reset') {
      const user = interaction.options.getUser('user', true);
      const removed = await new LevelingService(ctx.db).reset(guildId, user.id);
      // Without XP no reward is reached: strip the reward roles right away.
      const member = interaction.options.getMember('user');
      if (member instanceof GuildMember) await syncRewards(member, 0, { ...(await ctx.getConfig(guildId)), stackRewards: true }, ctx.logger);
      await reply(interaction, ctx.t(removed > 0 ? 'leveling.settings.reset' : 'leveling.settings.nothingToReset', { user: user.username }));
    }
  },
});
