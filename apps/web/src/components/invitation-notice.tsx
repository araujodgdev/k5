import Link from 'next/link';

export function InvitationNotice({ count }: { count: number }) {
  if (!count) return null;
  return <div className="flex min-w-0 flex-wrap items-center justify-end gap-3 border-b border-line px-5 py-3 md:px-10">
    <Link className="flex min-h-11 items-center text-sm underline underline-offset-4 md:min-h-9" href="/app/agenda?view=invites">{count === 1 ? '1 convite recebido' : `${count} convites recebidos`}</Link>
  </div>;
}
