import { database } from '../../src/lib/database';
import { projectNextNotification } from '../../src/lib/notifications/worker';

const target = process.env.K5_E2E_URL;
const connection = process.env.DATABASE_URL;
if (!target || !connection || !['localhost', '127.0.0.1'].includes(new URL(target).hostname)
  || !['localhost', '127.0.0.1'].includes(new URL(connection).hostname)) {
  throw new Error('A projeção e2e exige um servidor e PostgreSQL locais isolados.');
}
try {
  for (let count = 0; count < 500; count++) {
    if (!await projectNextNotification()) break;
    if (count === 499) throw new Error('Fila de notificações excedeu o limite da prova.');
  }
} finally { await database.close(); }
