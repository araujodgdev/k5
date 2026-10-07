import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const Zip = require('pizzip');
const directory = process.argv[2];
if (!directory?.includes('20261006T234247-d88728')) throw new Error('Expected owned evidence directory');
const records: { path: string; consoleErrors: unknown[]; pageErrors: unknown[]; operationErrors: unknown[]; httpErrors: unknown[] }[] = [];
function walk(path: string) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const file = join(path, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.name === 'trace.zip') {
      const zip = new Zip(readFileSync(file));
      const record = { path: file, consoleErrors: [] as unknown[], pageErrors: [] as unknown[], operationErrors: [] as unknown[], httpErrors: [] as unknown[] };
      for (const [name, item] of Object.entries(zip.files) as [string, { asText(): string }][]) {
        if (!/\.(trace|network)$/.test(name)) continue;
        for (const line of item.asText().split('\n').filter(Boolean)) {
          const event = JSON.parse(line);
          if (event.type === 'resource-snapshot' && event.snapshot.response.status >= 400) record.httpErrors.push({ url: event.snapshot.request.url, status: event.snapshot.response.status, time: event.snapshot.startedDateTime });
          if (event.type === 'console' && event.messageType === 'error') record.consoleErrors.push({ time: event.time, text: event.text });
          if (event.type === 'event' && event.method === 'pageError') record.pageErrors.push(event.params);
          if (event.type === 'after' && event.error) record.operationErrors.push({ time: event.endTime, error: event.error.message });
        }
      }
      records.push(record);
    }
  }
}
walk(join(directory, 'artifacts'));
writeFileSync(join(directory, 'source-trace-audit.json'), JSON.stringify(records, null, 2));
console.log(JSON.stringify({ traces: records.length, consoleErrors: records.reduce((n, record) => n + record.consoleErrors.length, 0),
  pageErrors: records.reduce((n, record) => n + record.pageErrors.length, 0), operationErrors: records.filter(record => record.operationErrors.length).map(record => ({ path: record.path, errors: record.operationErrors })) }));
