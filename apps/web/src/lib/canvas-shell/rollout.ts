import { evaluateBooleanFlag } from '@/lib/flagship';
import { canvasShellEnvironment } from './environment';

export const CANVAS_SHELL_FLAG_KEY = 'canvas-shell';

/** The Lume panel and the canvas replace the sidebar for offices in the pilot. */
export function isCanvasShellEnabled(officeId: string): Promise<boolean> {
  if (!officeId) return Promise.resolve(false);
  const env = canvasShellEnvironment();
  // Local development, the verify instance and e2e turn the shell on without Flagship.
  if (env.K5_CANVAS_SHELL === 'on') return Promise.resolve(true);
  return evaluateBooleanFlag(CANVAS_SHELL_FLAG_KEY, { office_id: officeId, targetingKey: officeId }, env);
}
