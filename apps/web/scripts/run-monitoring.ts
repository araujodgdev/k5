import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';

const name = z.enum(['queues', 'journeys', 'status']).parse(process.argv[2]);
const secrets = z.object({ MONITOR_RUN_TOKEN: z.string().min(32) })
  .parse(JSON.parse(readFileSync('.data/monitoring/secrets.json', 'utf8')));
const response = await fetch(`https://lume-monitoring.k5-web.workers.dev/${name}`, {
  method: name === 'status' ? 'GET' : 'POST',
  headers: { authorization: `Bearer ${secrets.MONITOR_RUN_TOKEN}` }, signal: AbortSignal.timeout(6 * 60_000),
});
const result: unknown = await response.json();
writeFileSync(`.data/monitoring/remote-${name}.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ httpStatus: response.status, result }, null, 2));
if (!response.ok) process.exitCode = 1;
