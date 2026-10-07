import { requireWorkspace } from '@/lib/session';
import { Inicio } from '@/components/inicio/inicio';
import { lumeWork, officeCases } from './data';

export const metadata = { title: "Início" };

export default async function HomePage() {
  const { user, office } = await requireWorkspace();
  const [cases, lume] = await Promise.all([officeCases(office.officeId, user.id), lumeWork(office.officeId, user.id)]);
  return <Inicio cases={cases} lume={lume} />;
}
