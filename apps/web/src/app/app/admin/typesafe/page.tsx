import { redirect } from 'next/navigation';

/** TypeSafe now lives in the IA tab, beside the Lume's model. */
export default function PlatformTypesafePage() { redirect('/app/admin/ai'); }
