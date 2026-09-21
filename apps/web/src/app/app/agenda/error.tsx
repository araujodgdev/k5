'use client';
import { Button } from '@/components/ui/button';
export default function Error({ reset }: { reset: () => void }) {
  return <div className="space-y-4 p-8"><p role="alert">Não foi possível carregar a agenda.</p><Button variant="outline" onClick={reset}>Tentar novamente</Button></div>;
}
