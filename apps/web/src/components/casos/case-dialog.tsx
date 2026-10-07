"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * The board's dialog (`Compartilhar.dc.html`): a 540px raised sheet 96px from the top over the
 * scrim, a 17px title above a quiet line, the close button on the right. On a phone it sits 16px
 * from the top and scrolls when its content is taller than the screen.
 */
export function CaseDialog({ open, onOpenChange, title, description, className, children }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} overlayClassName="bg-overlay/25 dark:bg-overlay/50"
        {...(description ? {} : { "aria-describedby": undefined })}
        className={cn("top-4 flex max-h-[calc(100dvh-2rem)] w-[540px] translate-y-0 flex-col gap-[18px] overflow-y-auto rounded-xl border-border bg-card px-6 pt-[22px] pb-5 sm:max-w-[540px] md:top-24 md:max-h-[calc(100dvh-8rem)]", className)}>
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <DialogTitle className="text-[17px] leading-snug font-semibold tracking-[-0.01em] break-words">{title}</DialogTitle>
            {description && <DialogDescription className="text-[13px] text-muted-foreground">{description}</DialogDescription>}
          </div>
          <DialogClose asChild>
            <Button variant="ghost" size="icon" className="size-11 shrink-0 text-muted-foreground md:size-[30px]" aria-label="Fechar"><X className="size-4" /></Button>
          </DialogClose>
        </div>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/** The dialog's last line: a quiet action on the left, the main one on the right. */
export function CaseDialogFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-2 [&>[data-slot=button]]:max-md:h-11", className)}>{children}</div>;
}
