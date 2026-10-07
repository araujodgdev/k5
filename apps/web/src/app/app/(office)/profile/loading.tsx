import { CanvasHeader, CanvasPage } from '@/components/canvas/canvas-page';

export default function LoadingProfile() {
  return <CanvasPage width="wide"><CanvasHeader title="Perfil" /><p role="status" className="text-[13.5px] text-muted-foreground">Carregando seu perfil…</p></CanvasPage>;
}
