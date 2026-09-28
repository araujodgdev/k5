import { z } from 'zod';

export const helpSearchInput = z.object({ query: z.string().trim().min(2).max(500), limit: z.number().int().min(1).max(8).default(5) });
export const helpSearchOutput = z.object({ version: z.string(), mode: z.enum(['semantic', 'text']), degraded: z.boolean(), sources: z.array(z.object({ id: z.string(), title: z.string(), text: z.string(), href: z.string() })) });
