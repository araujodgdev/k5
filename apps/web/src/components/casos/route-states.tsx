"use client";

import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CanvasPage } from "@/components/canvas/canvas-page";

const CARDS = 6;

/** While a case or the case list loads: the header and a grid of quiet cards in the board's sizes. */
export function CasosLoading({ label, card }: { label: string; card: "case" | "item" }) {
  return (
    <CanvasPage width="wide" className="md:gap-6 md:pt-9">
      <div role="status" aria-label={label} className="flex flex-col gap-6">
        <Skeleton className="h-8 w-56" />
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(260px,100%),1fr))] gap-3 md:gap-4">
          {Array.from({ length: CARDS }, (_, index) => <Skeleton key={index} className={card === "case" ? "h-40 rounded-lg md:h-[248px]" : "h-14 rounded-lg md:h-[182px]"} />)}
        </div>
      </div>
    </CanvasPage>
  );
}

export function CasosError({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <CanvasPage width="wide" className="md:pt-9">
      <div className="flex flex-col items-start gap-4">
        <p role="alert" className="flex items-start gap-2 text-[13.5px] text-destructive"><CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{message}</p>
        {retry && <Button variant="outline" className="max-md:h-11" onClick={() => retry()}>Tentar novamente</Button>}
      </div>
    </CanvasPage>
  );
}
