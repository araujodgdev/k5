import type { ReactNode } from 'react';

/** A Perfil section's name and what it is for, in the left column from `lg`. */
export function ProfileSectionHead({ id, title, children }: { id: string; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 id={id} className="text-[15px] font-semibold">{title}</h2>
      {children && <p className="text-[13.5px] text-muted-foreground">{children}</p>}
    </div>
  );
}
