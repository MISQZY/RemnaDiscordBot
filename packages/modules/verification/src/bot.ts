import { defineComponent, type BotModuleContext, type InteractionContext } from '@bot/core';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, type ButtonInteraction, type GuildMember, type PartialGuildMember } from 'discord.js';
import type { VerificationConfig } from './config.js';
import { isVerified, kickKey, makeChallenge, PREFIX, verifyMember } from './service.js';

type Ctx = BotModuleContext<VerificationConfig>;

const challengeKey = (guildId: string, userId: string) => `verification:challenge:${guildId}:${userId}`;
const failsKey = (guildId: string, userId: string) => `verification:fails:${guildId}:${userId}`;
const MAX_FAILS = 3;
const FAIL_LOCK_SEC = 600;

export async function onMemberJoin(ctx: Ctx, member: GuildMember): Promise<void> {
  if (member.user.bot) return;
  const config = await ctx.getConfig(member.guild.id);
  if (config.unverifiedRoleId) {
    await member.roles.add(config.unverifiedRoleId, 'Verification: not verified yet').catch((err: unknown) => ctx.logger.warn({ err, guildId: member.guild.id }, 'Unverified role not given'));
  }
  if (config.kickAfterMin > 0) {
    await ctx.scheduler.schedule({
      guildId: member.guild.id,
      moduleId: 'verification',
      job: 'kick',
      payload: { userId: member.id },
      runAt: new Date(Date.now() + config.kickAfterMin * 60_000),
      key: kickKey(member.guild.id, member.id),
    });
  }
}

export async function onMemberLeave(ctx: Ctx, member: GuildMember | PartialGuildMember): Promise<void> {
  await ctx.scheduler.cancel(kickKey(member.guild.id, member.id));
}

async function log(ctx: InteractionContext<VerificationConfig>, member: GuildMember, config: VerificationConfig, key: string): Promise<void> {
  if (!config.logChannelId) return;
  const channel = member.guild.channels.cache.get(config.logChannelId);
  if (!channel?.isSendable()) return;
  await channel.send({ content: ctx.tGuild(`verification.log.${key}`, { user: `<@${member.id}>`, name: member.user.username }), allowedMentions: { parse: [] } }).catch(() => undefined);
}

async function pass(interaction: ButtonInteraction<'cached'>, ctx: InteractionContext<VerificationConfig>, config: VerificationConfig): Promise<void> {
  await verifyMember(ctx, interaction.guildId, interaction.user.id, config, 'Verification passed');
  await ctx.redis.del(challengeKey(interaction.guildId, interaction.user.id), failsKey(interaction.guildId, interaction.user.id));
  await log(ctx, interaction.member, config, 'passed');
}

function challengeMessage(ctx: InteractionContext<VerificationConfig>, options: readonly string[], answer: number) {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    options.map((emoji, i) => new ButtonBuilder().setCustomId(`${PREFIX}:pick:${i}`).setEmoji(emoji).setStyle(ButtonStyle.Secondary)),
  );
  return { content: ctx.t('verification.captcha', { emoji: options[answer]! }), components: [row] };
}

/** The verification button and the captcha's options. */
export const verificationComponent = defineComponent<VerificationConfig>({
  async handle(interaction, ctx) {
    if (!interaction.inCachedGuild() || !interaction.isButton()) return;
    const [, action, option] = interaction.customId.split(':');
    const config = await ctx.getConfig(interaction.guildId);
    const member = interaction.member;
    const ephemeral = (content: string) => ({ content, flags: MessageFlags.Ephemeral as const });

    if (!config.roleId && !config.unverifiedRoleId) return void (await interaction.reply(ephemeral(ctx.t('verification.notSetUp'))));
    if (isVerified(new Set(member.roles.cache.keys()), config)) return void (await interaction.reply(ephemeral(ctx.t('verification.already'))));

    if (action === 'start') {
      const ageDays = (Date.now() - member.user.createdTimestamp) / 86_400_000;
      if (ageDays < config.minAccountAgeDays) {
        await log(ctx, member, config, 'tooYoung');
        return void (await interaction.reply(ephemeral(ctx.t('verification.tooYoung', { days: config.minAccountAgeDays }))));
      }
      if (Number(await ctx.redis.get(failsKey(interaction.guildId, member.id))) >= MAX_FAILS) {
        return void (await interaction.reply(ephemeral(ctx.t('verification.locked'))));
      }
      if (config.mode === 'button') {
        await pass(interaction, ctx, config);
        return void (await interaction.reply(ephemeral(ctx.t('verification.passed'))));
      }
      const { options, answer } = makeChallenge();
      await ctx.redis.set(challengeKey(interaction.guildId, member.id), JSON.stringify({ options, answer }), 'EX', 300);
      await interaction.reply({ ...challengeMessage(ctx, options, answer), flags: MessageFlags.Ephemeral });
      return;
    }

    if (action !== 'pick') return;
    const raw = await ctx.redis.get(challengeKey(interaction.guildId, member.id));
    if (!raw) return void (await interaction.update({ content: ctx.t('verification.expired'), components: [] }));
    const challenge = JSON.parse(raw) as { options: string[]; answer: number };

    if (Number(option) === challenge.answer) {
      await pass(interaction, ctx, config);
      await interaction.update({ content: ctx.t('verification.passed'), components: [] });
      return;
    }

    const fails = await ctx.redis.incr(failsKey(interaction.guildId, member.id));
    await ctx.redis.expire(failsKey(interaction.guildId, member.id), FAIL_LOCK_SEC);
    if (fails >= MAX_FAILS) {
      await ctx.redis.del(challengeKey(interaction.guildId, member.id));
      await log(ctx, member, config, 'failed');
      return void (await interaction.update({ content: ctx.t('verification.locked'), components: [] }));
    }
    const next = makeChallenge();
    await ctx.redis.set(challengeKey(interaction.guildId, member.id), JSON.stringify(next), 'EX', 300);
    const message = challengeMessage(ctx, next.options, next.answer);
    await interaction.update({ ...message, content: `${ctx.t('verification.wrong')}\n${message.content}` });
  },
});
