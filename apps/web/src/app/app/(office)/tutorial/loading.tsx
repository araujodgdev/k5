import { CanvasHeader, CanvasPage } from '@/components/canvas/canvas-page';

export default function TutorialLoading() {
  return <CanvasPage><CanvasHeader title="Tutoriais do Lume" /><p role="status" className="text-[13.5px] text-muted-foreground">Carregando tutoriais…</p></CanvasPage>;
}
