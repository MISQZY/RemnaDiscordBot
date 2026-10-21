import { MessageTemplate, Snowflake } from '@bot/contracts';
import { z } from 'zod';

export const VerificationConfig = z.object({
  /** Given once a member passes. */
  roleId: Snowflake.nullable(),
  /** Given on join and taken away once a member passes — a role that sees only the verification channel. */
  unverifiedRoleId: Snowflake.nullable(),
  /** `button` — one press; `captcha` — pick the shown emoji among several. */
  mode: z.enum(['button', 'captcha']),
  /** Younger accounts cannot pass; 0 — any. */
  minAccountAgeDays: z.number().int().min(0).max(365),
  /** Kick those who have not passed within this time; 0 — never. */
  kickAfterMin: z.number().int().min(0).max(10_080),
  logChannelId: Snowflake.nullable(),
  panel: z.object({
    channelId: Snowflake.nullable(),
    message: MessageTemplate,
    buttonLabel: z.string().trim().min(1).max(80),
  }),
});
export type VerificationConfig = z.infer<typeof VerificationConfig>;

export const defaultVerificationConfig: VerificationConfig = {
  roleId: null,
  unverifiedRoleId: null,
  mode: 'button',
  minAccountAgeDays: 0,
  kickAfterMin: 0,
  logChannelId: null,
  panel: {
    channelId: null,
    message: { content: 'Добро пожаловать на **{guild.name}**! Нажмите кнопку ниже, чтобы получить доступ к серверу.' },
    buttonLabel: 'Подтвердить',
  },
};

/** The verification message as the API answers it. */
export const PanelState = z.object({ channelId: Snowflake, messageId: Snowflake, updatedAt: z.iso.datetime() }).nullable();
