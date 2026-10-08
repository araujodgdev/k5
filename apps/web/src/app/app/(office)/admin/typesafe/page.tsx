import { AdminCanvas } from '@/components/admin/admin-canvas';
import { officePage } from '@/components/lume/canvas-leaf';
import { redirect } from 'next/navigation';

/** TypeSafe now lives in the IA tab, beside the Lume's model. */
function PlatformTypesafePage() { return redirect('/app/admin/ai'); }

export default officePage('/app/admin/typesafe', PlatformTypesafePage, AdminCanvas);
