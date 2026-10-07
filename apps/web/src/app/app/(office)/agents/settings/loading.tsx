import { CanvasHeader, CanvasPage } from '@/components/canvas/canvas-page';

export default function Loading() {
  return <CanvasPage><CanvasHeader title="Personalizar Lume" /><p role="status" className="text-[13.5px] text-muted-foreground">Carregando configurações…</p></CanvasPage>;
}
