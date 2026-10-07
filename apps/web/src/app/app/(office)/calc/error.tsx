'use client';
import { Button } from '@/components/ui/button';
export default function Error({ reset }: { reset: () => void }) { return <div className="grid gap-4 p-8"><p role="alert">Não foi possível abrir os cálculos.</p><Button className="justify-self-start" onClick={reset}>Tentar novamente</Button></div>; }
