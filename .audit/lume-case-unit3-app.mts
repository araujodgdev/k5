// Recovery supervisor for this single disposable run. It preserves its PostgreSQL and credentials.
import { readFileSync, writeFileSync, existsSync, openSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url)),web=join(root,'apps/web');
const webRequire=createRequire(join(web,'package.json'));
const pointer=JSON.parse(readFileSync(join(tmpdir(),'lume-verify-current.json'),'utf8'));
const stateFile=join(pointer.runDir,'state.json');
const state=JSON.parse(readFileSync(stateFile,'utf8'));
if(state.runId!=='20261006T234247-d88728'||state.port!==62541||state.pgPort!==62542||dirname(resolve(state.runDir))!==resolve(tmpdir()))throw Error('Wrong disposable run');
const isolated=Object.fromEntries(readFileSync(join(state.runDir,'verify.env'),'utf8').trim().split(/\r?\n/).map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];}));
const names=[...readFileSync(join(web,'.env.example'),'utf8').matchAll(/^#?\s*([A-Z][A-Z_0-9]+)=/gm)].map(match=>match[1]);
const blank=Object.fromEntries([...names,'SENTRY_AUTH_TOKEN','OPENAI_API_KEY'].filter(name=>!(name in isolated)).map(name=>[name,'']));
const log=openSync(state.log,'a');
const {default:getBinaries}=await import(pathToFileURL(join(dirname(webRequire.resolve('embedded-postgres')),'binary.js')).href);
const {pg_ctl}=await getBinaries();
if(process.argv.includes('--stop')) {
  spawnSync(pg_ctl,['stop','-D',join(state.runDir,'pg'),'-m','fast','-w','-t','30'],{windowsHide:true,stdio:'ignore'});
  if(state.nextPid)spawnSync('taskkill',['/PID',String(state.nextPid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
  if(state.supervisorPid)spawnSync('taskkill',['/PID',String(state.supervisorPid),'/F'],{windowsHide:true,stdio:'ignore'});
  state.status='stopped';writeFileSync(stateFile,JSON.stringify(state,null,2));process.exit(0);
}
if(spawnSync(pg_ctl,['status','-D',join(state.runDir,'pg')],{windowsHide:true,stdio:'ignore'}).status!==0) {
  const started=spawnSync(pg_ctl,['start','-D',join(state.runDir,'pg'),'-o','-h 127.0.0.1 -p 62542','-l',join(state.runDir,'recovery-pg.log'),'-w','-t','30'],{windowsHide:true,stdio:'ignore'});
  if(started.status!==0)throw Error('Owned PostgreSQL recovery failed');
}
state.postmasterPid=Number(readFileSync(join(state.runDir,'pg/postmaster.pid'),'utf8').split(/\r?\n/)[0]);
const next=spawn(process.execPath,[webRequire.resolve('next/dist/bin/next'),'dev','--port','62541','--hostname','127.0.0.1'],{
  cwd:web,stdio:['ignore',log,log],windowsHide:true,
  env:{...process.env,...blank,...isolated,K5_ENV_FILE:join(state.runDir,'verify.env'),K5_NEXT_DIST_DIR:'.next-verify',NEXT_TELEMETRY_DISABLED:'1'},
});
state.nextPid=next.pid;state.supervisorPid=process.pid;state.status='starting';delete state.error;
writeFileSync(stateFile,JSON.stringify(state,null,2));
appendFileSync(state.log,'\n[unit3] Replaced app supervisor after Turbopack HMR panic. PostgreSQL and credentials preserved.\n');
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const stop=async()=>{
  if(next.pid)spawnSync('taskkill',['/PID',String(next.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
  spawnSync(pg_ctl,['stop','-D',join(state.runDir,'pg'),'-m','fast','-w','-t','30'],{windowsHide:true,stdio:'ignore'});
};
try {
  const deadline=Date.now()+300_000;
  for(;;){
    if(next.exitCode!==null || Date.now()>deadline)throw Error('Recovered app did not become ready');
    try{const response=await fetch(state.baseURL+'/sign-in',{signal:AbortSignal.timeout(10_000)});if(response.ok && (await response.text()).includes('Entre no Lume'))break;}catch{}
    await sleep(1000);
  }
  state.status='ready';writeFileSync(stateFile,JSON.stringify(state,null,2));
  while(!existsSync(join(state.runDir,'stop')) && next.exitCode===null)await sleep(500);
  await stop();state.status='stopped';writeFileSync(stateFile,JSON.stringify(state,null,2));
} catch(error){state.status='failed';state.error=error instanceof Error ? error.message : String(error);writeFileSync(stateFile,JSON.stringify(state,null,2));}
