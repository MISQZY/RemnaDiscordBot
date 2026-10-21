import { ButtonStyle, type APIMessageComponentEmoji } from 'discord.js';

/** Button colours as configs name them. */
export const BUTTON_STYLES = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
} as const;
export type ButtonStyleName = keyof typeof BUTTON_STYLES;

/** A Unicode emoji or a custom `<:name:id>` / `<a:name:id>` as Discord components take it. */
export function parseEmoji(emoji: string | undefined | null): APIMessageComponentEmoji | undefined {
  if (!emoji) return undefined;
  const custom = /^<(a?):(\w+):(\d+)>$/.exec(emoji);
  return custom ? { id: custom[3], name: custom[2], animated: custom[1] === 'a' } : { name: emoji };
}
