import type { ChatTurn } from '../../src/lib/chat-turn';
export { chatRunResponse } from '../../src/lib/chat-run';

const state = globalThis as typeof globalThis & { testChatExecutor?: { turns: ChatTurn[] } };
export const executor = state.testChatExecutor ??= { turns: [] };
export async function startChatRun(turn: ChatTurn) { executor.turns.push(turn); }
export async function followChatRun() { return new Response('data: [DONE]\n\n').body; }
