import { z } from 'zod';

const HexColor = z.number().int().min(0).max(0xffffff);

export const EmbedTemplate = z.object({
  title: z.string().max(256).optional(),
  description: z.string().max(4096).optional(),
  url: z.url().optional(),
  color: HexColor.optional(),
  author: z
    .object({
      name: z.string().max(256),
      url: z.url().optional(),
      iconUrl: z.string().optional(),
    })
    .optional(),
  thumbnailUrl: z.string().optional(),
  imageUrl: z.string().optional(),
  fields: z
    .array(
      z.object({
        name: z.string().min(1).max(256),
        value: z.string().min(1).max(1024),
        inline: z.boolean().default(false),
      }),
    )
    .max(25)
    .optional(),
  footer: z
    .object({
      text: z.string().max(2048),
      iconUrl: z.string().optional(),
    })
    .optional(),
  timestamp: z.boolean().optional(),
});
export type EmbedTemplate = z.infer<typeof EmbedTemplate>;

export const AllowedMentions = z.object({
  users: z.boolean().default(true),
  roles: z.boolean().default(false),
  everyone: z.boolean().default(false),
});
export type AllowedMentions = z.infer<typeof AllowedMentions>;

/** A message with placeholders: `{user.mention}`, `{guild.name}`, etc. */
export const MessageTemplate = z
  .object({
    content: z.string().max(2000).optional(),
    embeds: z.array(EmbedTemplate).max(10).optional(),
    allowedMentions: AllowedMentions.optional(),
  })
  .refine((m) => Boolean(m.content?.trim()) || (m.embeds?.length ?? 0) > 0, {
    message: 'Message must have content or at least one embed',
  });
export type MessageTemplate = z.infer<typeof MessageTemplate>;
