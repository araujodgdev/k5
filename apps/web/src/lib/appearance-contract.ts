import { z } from 'zod';

export const officeAccents = ['orange', 'blue', 'green', 'violet'] as const;
export type OfficeAccent = typeof officeAccents[number];
export const appearanceInput = z.strictObject({ accent: z.enum(officeAccents) });
export const accentLabels: Record<OfficeAccent, string> = { orange: 'Laranja', blue: 'Azul', green: 'Verde', violet: 'Violeta' };
export function officeAccent(value: unknown): OfficeAccent {
  return officeAccents.includes(value as OfficeAccent) ? value as OfficeAccent : 'orange';
}
