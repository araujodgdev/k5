import 'server-only';
import { createUIMessageStream, JsonToSseTransformStream, UI_MESSAGE_STREAM_HEADERS, type UIMessageChunk } from 'ai';
import { captureOperationalError } from '@/lib/observability/report';
import { runChatTurn, type ChatTurn } from '@/lib/chat-turn';
import { holdsTurn, TurnFenced } from '@/lib/chat-lease';

/**
 * A chat turn in flight: the chunks written so far and the runs following them. Whoever connects
 * (the request that sent the message, or the page reopened later) gets everything from the start,
 * then the rest live. Closing the page only drops a follower; the turn runs to the end.
 */
export class ChatRun {
  private readonly chunks: UIMessageChunk[] = [];
  private readonly waiting = new Set<() => void>();
  readonly controller = new AbortController();
  messageId: string | undefined;
  done = false;

  /** The lease token of the turn this run answers. */
  constructor(readonly token: string) {}

  push(chunk: UIMessageChunk) {
    if (chunk.type === 'start' && chunk.messageId) this.messageId = chunk.messageId;
    this.chunks.push(chunk);
    this.wake();
  }

  finish() { this.done = true; this.wake(); }

  private wake() { for (const resolve of this.waiting) resolve(); this.waiting.clear(); }

  follow(): ReadableStream<Uint8Array> {
    let index = 0;
    const chunks = new ReadableStream<UIMessageChunk>({
      pull: async controller => {
        while (index >= this.chunks.length && !this.done) await new Promise<void>(resolve => this.waiting.add(resolve));
        if (index < this.chunks.length) controller.enqueue(this.chunks[index++]);
        else controller.close();
      },
    });
    return chunks.pipeThrough(new JsonToSseTransformStream()).pipeThrough(new TextEncoderStream());
  }
}

/** Runs the turn into `run`; resolves when the answer is stored. Never rejects. */
export async function executeChatRun(run: ChatRun, turn: ChatTurn) {
  const stream = createUIMessageStream({
    execute: ({ writer }) => runChatTurn(turn, writer, run.controller.signal),
    onError: error => {
      captureOperationalError(error, 'chat.response');
      return 'Não foi possível concluir a resposta.';
    },
  });
  const reader = stream.getReader();
  try {
    for (let next = await reader.read(); !next.done; next = await reader.read()) run.push(next.value);
  } catch (error) {
    captureOperationalError(error, 'chat.run');
  } finally {
    run.finish();
  }
}

/**
 * The run a start should begin, or null when it repeats the start of the run in flight. Any other
 * start must hold the conversation's lease: a late or replayed one is refused, so it never stops a
 * live run, and a current one ends the run it replaces, whose lease has already expired.
 */
export async function nextRun(active: () => ChatRun | undefined, install: (run: ChatRun) => void, turn: ChatTurn): Promise<ChatRun | null> {
  for (;;) {
    const previous = active();
    if (previous?.token === turn.lease.token) return null;
    if (!await holdsTurn(turn.workspace, turn.conversationId, turn.lease)) throw new TurnFenced();
    if (active() !== previous) continue;
    const run = new ChatRun(turn.lease.token);
    install(run);
    previous?.controller.abort();
    return run;
  }
}

/** The finished run stays followable briefly, for a page that reopened just as it ended. */
const FINISHED_RUN_MS = 120_000;

type ChatRunStub = {
  start(turn: ChatTurn): Promise<void>;
  follow(lastMessageId?: string): Promise<ReadableStream<Uint8Array> | null>;
  cancel(): Promise<boolean>;
};
type ChatRunNamespace = { getByName(name: string): ChatRunStub };

/** The Durable Object namespace on Cloudflare; undefined in Node, where the process itself keeps the run. */
async function durableRuns(): Promise<ChatRunNamespace | undefined> {
  try {
    const { env } = await import(/* webpackIgnore: true */ 'cloudflare:workers');
    return env.CHAT_RUNS as ChatRunNamespace | undefined;
  } catch {
    return undefined;
  }
}

const processRuns = (globalThis as typeof globalThis & { k5ChatRuns?: Map<string, ChatRun> }).k5ChatRuns ??= new Map();

/**
 * What a follower may receive: nothing when the page already shows the finished answer (a replay
 * would append it twice), otherwise the whole run.
 */
export function followable(run: ChatRun | undefined, lastMessageId?: string) {
  if (!run || (run.done && run.messageId && run.messageId === lastMessageId)) return null;
  return run.follow();
}

export async function startChatRun(turn: ChatTurn) {
  const durable = await durableRuns();
  if (durable) return durable.getByName(turn.conversationId).start(turn);
  const run = await nextRun(() => processRuns.get(turn.conversationId), run => processRuns.set(turn.conversationId, run), turn);
  if (!run) return;
  void executeChatRun(run, turn).finally(() => setTimeout(() => {
    if (processRuns.get(turn.conversationId) === run) processRuns.delete(turn.conversationId);
  }, FINISHED_RUN_MS).unref?.());
}

/** Callers check that the conversation belongs to the person before following or cancelling it. */
export async function followChatRun(conversationId: string, lastMessageId?: string) {
  const durable = await durableRuns();
  if (durable) return durable.getByName(conversationId).follow(lastMessageId);
  return followable(processRuns.get(conversationId), lastMessageId);
}

export async function cancelChatRun(conversationId: string) {
  const durable = await durableRuns();
  if (durable) return durable.getByName(conversationId).cancel();
  const run = processRuns.get(conversationId);
  if (!run || run.done) return false;
  run.controller.abort();
  return true;
}

export function chatRunResponse(stream: ReadableStream<Uint8Array>) {
  return new Response(stream, { headers: UI_MESSAGE_STREAM_HEADERS });
}
