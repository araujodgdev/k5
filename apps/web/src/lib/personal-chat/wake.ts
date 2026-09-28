import { captureOperationalError } from '@/lib/observability/report';
import { personalChatEnvironment } from './environment';

export async function wakePersonalEmailWorker() {
  const queue = personalChatEnvironment().INTEGRATIONS_QUEUE;
  if (!queue) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      queue.send({ kind: 'sweep' }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Personal email queue wake timed out')), 1_500); }),
    ]);
  } catch (error) {
    captureOperationalError(error, 'personal-email.queue.wake');
  } finally {
    clearTimeout(timer);
  }
}
