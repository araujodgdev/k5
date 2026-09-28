'use client';

import { Button } from '@/components/ui/button';

export default function HonorariosError({ retry, reset }: { retry?: () => void; reset?: () => void }) {
  return <div className="grid justify-items-start gap-5 px-5 py-6 md:px-10 md:py-10"><h1 className="page-title max-md:sr-only">Honorários</h1><p role="alert" className="text-sm text-destructive">Não foi possível abrir os honorários.</p><Button className="min-h-11" variant="outline" onClick={retry ?? reset}>Tentar novamente</Button></div>;
}
