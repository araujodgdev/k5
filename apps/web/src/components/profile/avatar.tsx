import { initials } from '@/lib/profile-contract';
import { cn } from '@/lib/utils';

/** The person's photo, or their initials on the quiet fill. Avatars are the one round thing besides dots. */
export function Avatar({ name, src, className }: { name: string; src?: string | null; className?: string }) {
  return (
    <span aria-hidden="true" className={cn('grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-xs font-medium text-muted-foreground select-none', className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- private, versioned route that needs the session cookie */}
      {src ? <img src={src} alt="" className="size-full object-cover" /> : initials(name)}
    </span>
  );
}
