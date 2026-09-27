import { redirect } from 'next/navigation';

/** TypeSafe now lives in the IA tab, beside Tises' model. */
export default function PlatformTypesafePage() { redirect('/app/admin/ai'); }
