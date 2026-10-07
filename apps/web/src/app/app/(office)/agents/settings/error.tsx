'use client';

import { CanvasHeader, CanvasPage } from '@/components/canvas/canvas-page';
import { Button } from '@/components/ui/button';

export default function AgentSettingsError({ retry, reset }: { retry?: () => void; reset?: () => void }) {
  return <CanvasPage>
    <CanvasHeader title="Personalizar Lume" />
    <div className="flex flex-wrap items-center gap-3">
      <p role="alert" className="text-[13.5px] text-destructive">Não foi possível abrir as configurações do Lume.</p>
      <Button variant="outline" size="lg" className="h-11 md:h-[34px]" onClick={retry ?? reset}>Tentar novamente</Button>
    </div>
  </CanvasPage>;
}
