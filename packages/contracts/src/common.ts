import { z } from 'zod';

/** Discord snowflake ID. Stored as a string: a JS number cannot hold it losslessly. */
export const Snowflake = z.string().regex(/^\d{17,20}$/, 'Invalid Discord ID');
export type Snowflake = z.infer<typeof Snowflake>;

export const SUPPORTED_LOCALES = ['ru', 'en'] as const;
export const Locale = z.enum(SUPPORTED_LOCALES);
export type Locale = z.infer<typeof Locale>;

export const ModuleId = z.string().regex(/^[a-z][a-z0-9-]{1,31}$/, 'Invalid module ID');
export type ModuleId = z.infer<typeof ModuleId>;
