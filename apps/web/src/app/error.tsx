"use client";

import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="display text-[28px]">Não foi possível carregar esta página</h1>
      <p className="mb-3 text-muted-foreground">Tente novamente em instantes.</p>
      <Button onClick={reset}>Tentar novamente</Button>
    </div>
  );
}
