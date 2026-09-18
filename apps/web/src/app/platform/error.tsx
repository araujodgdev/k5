"use client";

import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function PlatformError({ retry }: { retry: () => void }) {
  return (
    <section className="mx-auto max-w-5xl py-12">
      <p className="flex items-start gap-2 text-destructive text-sm" role="alert"><CircleAlert className="mt-0.5 size-4 shrink-0" />Não foi possível carregar os dados da plataforma.</p>
      <Button className="mt-5" variant="outline" onClick={() => retry()}>Tentar novamente</Button>
    </section>
  );
}
