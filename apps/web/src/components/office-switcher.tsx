'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { OfficeMembership } from '@/lib/offices';

export function OfficeSwitcher({ offices, activeOfficeId, invitationCount = 0 }: { offices: OfficeMembership[]; activeOfficeId: string; invitationCount?: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (offices.length < 2 && !invitationCount) return null;
  return <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3 md:px-10">
    {offices.length > 1 && <label className="flex flex-wrap items-center gap-3 text-sm">Escritório ativo
      <select aria-label="Escritório ativo" value={activeOfficeId} disabled={busy} className="min-h-11 max-w-full border border-input bg-background px-3 md:min-h-9" onChange={async event => {
        setBusy(true); setError('');
        try {
          const response = await fetch('/api/offices/active', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ officeId: event.target.value }) });
          if (!response.ok) throw new Error('Não foi possível trocar de escritório.');
          // A full reload discards the previous office's client state and cached private requests.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.assign('/app/agenda?view=team');
        } catch { setError('Não foi possível trocar de escritório. Tente novamente.'); setBusy(false); }
      }}>{offices.map(office => <option key={office.officeId} value={office.officeId}>{office.officeName}</option>)}</select>
    </label>}{invitationCount > 0 && <Link className="flex min-h-11 items-center text-sm underline underline-offset-4 md:min-h-9" href="/app/agenda?view=invites">{invitationCount === 1 ? '1 convite recebido' : `${invitationCount} convites recebidos`}</Link>}{error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
  </div>;
}
