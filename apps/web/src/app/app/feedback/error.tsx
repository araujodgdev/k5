'use client';
import { Button } from '@/components/ui/button';

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <div className="p-8"><p role="alert" className="text-sm">Não foi possível carregar a avaliação.</p><Button className="mt-4 min-h-11" variant="outline" onClick={reset}>Tentar novamente</Button></div>;
}
