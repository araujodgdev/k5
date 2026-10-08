'use client';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useCanvasLoadError } from '@/components/lume/canvas-host';

export default function NotFound() {
  useCanvasLoadError();
  return (
    <div className="flex min-h-[50dvh] flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="page-title">Página não encontrada</h1>
      <p className="mb-3 text-muted-foreground">Esta tela não está disponível. Abra outro destino no canvas.</p>
      <Button asChild variant="outline"><Link href="/app/command-center">Voltar ao início</Link></Button>
    </div>
  );
}
