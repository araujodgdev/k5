import EmbeddedPostgres from 'embedded-postgres';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';

let postgres: EmbeddedPostgres | undefined;
let testDirectory: string | undefined;
let url = process.env.TEST_DATABASE_URL;
if (!url) {
  const listener = createServer();
  await new Promise<void>(resolve=>listener.listen(0,'127.0.0.1',resolve));
  const port = (listener.address() as {port:number}).port;
  await new Promise<void>((resolve,reject)=>listener.close(error=>error?reject(error):resolve()));
  const password = randomBytes(24).toString('hex');
  testDirectory = mkdtempSync(join(tmpdir(),'k5-pg-tests-'));
  // Every fixture migrates and later drops a whole schema in one transaction, locking each of its
  // ~650 relations (tables, indexes, TOAST). With files running in parallel, the default lock table
  // (64 per connection) runs out ("out of shared memory"); 256 leaves room for the schema to grow.
  postgres = new EmbeddedPostgres({databaseDir:join(testDirectory,'data'),
    user:'postgres',password,port,persistent:true,authMethod:'scram-sha-256',
    initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','max_locks_per_transaction=256'],onLog:()=>{},onError:()=>{}});
  await postgres.initialise();
  await postgres.start();
  url = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
}
let exitCode = 1;
try {
  const files=process.argv.slice(2);
  const child=spawn(process.execPath,['--import','tsx','--test','--test-concurrency=4',
    ...(files.length?files:readdirSync('tests').filter(file=>file.endsWith('.test.ts')).map(file=>`tests/${file}`))],
    {stdio:'inherit',windowsHide:true,env:{...process.env,TEST_DATABASE_URL:url}});
  exitCode=await new Promise<number>((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>resolve(code??1));});
} finally {
  await postgres?.stop();
  if (testDirectory) {
    // Windows can retain file handles briefly after PostgreSQL's process tree exits.
    // Remove only the fresh directory created by this invocation, with bounded retries.
    const owned = relative(resolve(tmpdir()), resolve(testDirectory));
    if (isAbsolute(owned) || owned.startsWith('..') || !/^k5-pg-tests-[\w-]+$/.test(owned)) {
      throw new Error('Refusing to remove a directory outside this test run.');
    }
    await rm(resolve(testDirectory), { recursive:true, force:true, maxRetries:10, retryDelay:200 });
  }
}

process.exit(exitCode);
