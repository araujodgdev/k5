import { requireWorkspace } from '@/lib/session';
import { ownProfile } from '@/lib/profile';
import { ProfilePage } from '@/components/profile/profile-page';
import { openDeletionRequest } from '@/lib/office-deletion';
import { personalEmailSettings } from '@/lib/personal-chat/email-transport';

export const metadata = { title: 'Perfil' };

export default async function Profile() {
  const { user, office } = await requireWorkspace();
  const [profile, deletion] = await Promise.all([ownProfile(user.id), openDeletionRequest(office.officeId)]);
  return <ProfilePage initial={profile} deletion={deletion ?? null} emailConfirmation={Boolean(personalEmailSettings())} />;
}
