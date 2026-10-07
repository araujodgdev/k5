import { AsyncLocalStorage } from 'node:async_hooks';
import type { FlagshipEnvironment } from '@/lib/flagship';

export type CanvasShellEnvironment = FlagshipEnvironment & Partial<Record<'K5_CANVAS_SHELL', string>>;
const environment = new AsyncLocalStorage<CanvasShellEnvironment>();
export function canvasShellEnvironment(): CanvasShellEnvironment { return environment.getStore() ?? process.env; }
export function withCanvasShellEnvironment<T>(env: CanvasShellEnvironment, action: () => T): T { return environment.run(env, action); }
