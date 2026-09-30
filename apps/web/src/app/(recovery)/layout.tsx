import type { Metadata } from 'next';
import Link from 'next/link';
import { LumeMark } from '@/components/lume-mark';
import { ThemeSwitch } from '@/components/theme-provider';
import { InstallApp } from '@/components/pwa-provider';

export const metadata: Metadata = { referrer: 'no-referrer', robots: { index: false, follow: false } };

export default function RecoveryLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh min-w-0">
    <header className="flex min-h-15 items-center justify-between gap-3 border-b border-line px-5 py-2 md:px-10">
      <Link href="/" className="inline-flex min-h-11 items-center gap-3 text-sm font-medium"><LumeMark width={22} height={22} aria-hidden="true" />Lume</Link>
      <div className="flex items-center gap-2"><InstallApp /><ThemeSwitch /></div>
    </header>
    {children}
  </div>;
}
