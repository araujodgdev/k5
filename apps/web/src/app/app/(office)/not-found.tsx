'use client';
import { useCanvasLoadError } from '@/components/lume/canvas-host';

export default function NotFound() {
  useCanvasLoadError();
  return <p className="px-5 py-6 text-sm">Esta tela não está disponível. Abra outro destino no canvas.</p>;
}
