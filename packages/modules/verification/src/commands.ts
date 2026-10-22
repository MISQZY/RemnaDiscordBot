import { defineCommand } from '@bot/core';
import { isElevatedRole, memberOutranksRole } from '@bot/discord';
import { ChannelType, InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { VerificationConfig } from './config.js';
import { publishPanel, verifyMember } from './service.js';

export const verifyCommand = defineCommand<VerificationConfig>({
  data: new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Let a member in without the check')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setContexts(InteractionContextType.Guild)
    .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),
  async execute(interaction, ctx) {
    const config = await ctx.getConfig(interaction.guildId!);
    const user = interaction.options.getUser('user', true);
    if (!config.roleId && !config.unverifiedRoleId) return void (await interaction.reply({ content: ctx.t('verification.notSetUp'), flags: MessageFlags.Ephemeral }));
    await verifyMember(ctx, interaction.guildId!, user.id, config, `Verified by ${interaction.user.username}`);
    await interaction.reply({ content: ctx.t('verification.manual', { user: user.username }), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  },
});

export const verificationCommand = defineCommand<VerificationConfig>({
  data: new SlashCommandBuilder()
    .setName('verification')
    .setDescription('Set up verification')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s
        .setName('post')
        .setDescription('Post the verification message')
        .addChannelOption((o) => o.setName('channel').setDescription('Channel; the one from the settings by default').addChannelTypes(ChannelType.GuildText)),
    )
    .addSubcommand((s) =>
      s
        .setName('roles')
        .setDescription('Roles of verification')
        .addRoleOption((o) => o.setName('verified').setDescription('Given after passing'))
        .addRoleOption((o) => o.setName('unverified').setDescription('Given on join, taken away after passing')),
    ),
  cooldownMs: 3_000,
  async execute(interaction, ctx) {
    const guildId = interaction.guildId!;
    const config = structuredClone(await ctx.getConfig(guildId));
    const reply = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

    if (interaction.options.getSubcommand() === 'roles') {
      const verified = interaction.options.getRole('verified');
      const unverified = interaction.options.getRole('unverified');
      for (const role of [verified, unverified]) {
        if (!role || !interaction.inCachedGuild()) continue;
        const picked = interaction.guild.roles.cache.get(role.id);
        if (!picked) continue;
        if (isElevatedRole(picked)) return void (await reply(ctx.t('core.roleElevated', { role: picked.name })));
        if (!memberOutranksRole(interaction.member, picked)) return void (await reply(ctx.t('core.roleAboveYou', { role: picked.name })));
      }
      config.roleId = verified?.id ?? null;
      config.unverifiedRoleId = unverified?.id ?? null;
      await ctx.config.update(guildId, ctx.moduleId, { config: VerificationConfig.parse(config) }, interaction.user.id);
      return void (await reply(ctx.t('verification.rolesSet', { verified: verified ? `<@&${verified.id}>` : '—', unverified: unverified ? `<@&${unverified.id}>` : '—' })));
    }

    const channel = interaction.options.getChannel('channel');
    if (channel) {
      config.panel.channelId = channel.id;
      await ctx.config.update(guildId, ctx.moduleId, { config: VerificationConfig.parse(config) }, interaction.user.id);
    }
    if (!config.panel.channelId) return void (await reply(ctx.t('verification.noChannel')));
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const posted = await publishPanel(ctx, guildId, config);
    await interaction.editReply(ctx.t('verification.posted', { channel: `<#${posted.channelId}>` }));
  },
});
