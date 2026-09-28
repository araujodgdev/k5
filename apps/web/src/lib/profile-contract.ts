import { z } from 'zod';

const text = (max: number, message: string) => z.string().trim().max(max, message);

/** Fields the person edits on /app/profile. The e-mail and password go through Better Auth. */
export const profileInput = z.object({
  name: z.string().trim().min(2, 'Informe seu nome.').max(120, 'Use até 120 caracteres no nome.'),
  headline: text(120, 'Use até 120 caracteres na atuação.'),
  oab: text(40, 'Use até 40 caracteres na OAB.'),
  location: text(120, 'Use até 120 caracteres na cidade.'),
  bio: text(600, 'Use até 600 caracteres no texto sobre você.'),
});
export type ProfileInput = z.infer<typeof profileInput>;

export const avatarTypes = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type AvatarType = (typeof avatarTypes)[number];
/** The browser resizes the photo before sending, so this only bounds a misbehaving client. */
export const avatarMaxBytes = 512 * 1024;
export const avatarSize = 256;

/** What another person sees on the card when looking up this e-mail. */
export type ProfileCard = {
  id: string;
  name: string;
  email: string;
  headline: string;
  oab: string;
  location: string;
  bio: string;
  avatarUrl: string | null;
  memberSince: string;
};

export const avatarUrl = (userId: string, version: string | null) =>
  version ? `/api/profile/avatar/${encodeURIComponent(userId)}?v=${encodeURIComponent(version)}` : null;

/** Two letters for the round placeholder when there is no photo. */
export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : (parts[0] ?? '?').slice(0, 2);
  return letters.toLocaleUpperCase('pt-BR');
}
