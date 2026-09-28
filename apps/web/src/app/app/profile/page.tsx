import { requireWorkspace } from '@/lib/session';
import { ownProfile } from '@/lib/profile';
import { ProfilePage } from '@/components/profile/profile-page';

export const metadata = { title: 'Perfil' };

export default async function Profile() {
  const { user } = await requireWorkspace();
  return <ProfilePage initial={await ownProfile(user.id)} />;
}
