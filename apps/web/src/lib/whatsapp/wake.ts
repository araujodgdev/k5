import 'server-only';
import { whatsappEnvironment } from './environment';
import { captureOperationalError } from '@/lib/observability/report';

export async function wakeWhatsAppWorker() {
  const queue = whatsappEnvironment().INTEGRATIONS_QUEUE;
  if (!queue) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([queue.send({ kind: 'sweep' }), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('WhatsApp queue wake timed out')), 1_500);
    })]);
  }
  catch (error) { captureOperationalError(error, 'whatsapp.queue.wake'); }
  finally { clearTimeout(timer); }
}
