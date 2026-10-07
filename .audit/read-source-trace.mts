import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const Zip = require('pizzip');
const zip = new Zip(readFileSync(process.argv[2]));
for (const [name, entry] of Object.entries(zip.files) as [string, { asText(): string }][]) {
  if (!/\.(network|trace)$/.test(name)) continue;
  for (const line of entry.asText().split('\n').filter(Boolean)) {
    const e = JSON.parse(line);
    if (e.type === 'resource-snapshot') {
      const x=e.snapshot; if (/localhost.*(\?_rsc|\/app\/|\/api\/cases|\/api\/canvas)/.test(x.request?.url)) console.log(JSON.stringify({file:name,url:x.request.url,status:x.response?.status,start:x.startedDateTime,time:x.time,timings:x.timings}));
    } else if (e.type === 'console' && e.messageType === 'error' || e.type === 'event' && e.method === 'pageError') console.log(JSON.stringify(e));
  }
}
