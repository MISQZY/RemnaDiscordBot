import { z } from 'zod';

export const GeneralConfig = z.object({});
export type GeneralConfig = z.infer<typeof GeneralConfig>;
