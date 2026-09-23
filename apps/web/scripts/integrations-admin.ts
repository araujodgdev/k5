import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
if (existsSync(resolve('.env.local'))) process.loadEnvFile(resolve('.env.local'));

async function main() {
  const args=process.argv.slice(2);
  const read=(flag:string)=>{const index=args.indexOf(flag);return index>=0?args[index+1]:undefined;};
  const email=read('--email'),officeId=read('--office'),modules=read('--modules')?.split(','),enabled=read('--enabled');
  if(!email||!officeId||!modules?.length||!['true','false'].includes(enabled??'')||modules.some(m=>!['gmail','calendar','drive','docs'].includes(m))) {
    throw new Error('Uso: pnpm integrations:admin --email admin@exemplo.com --office ID --modules gmail,calendar,drive,docs --enabled true|false');
  }
  const {database}=await import('../src/lib/database');
  try {
    const {findUserForPlatformGrant,isPlatformAdmin}=await import('../src/lib/platform-core');
    const user=await findUserForPlatformGrant(database,{email});
    if(!user||!await isPlatformAdmin(database,user.id))throw new Error('O responsável deve ser administrador da plataforma.');
    if(!await database.prepare('SELECT 1 FROM office WHERE id=?').get(officeId))throw new Error('Escritório não encontrado.');
    await database.batch([...new Set(modules)].map(feature=>database.prepare(`INSERT INTO google_rollout(office_id,module,enabled,updated_by)
      VALUES(?,?,?,?) ON CONFLICT(office_id,module) DO UPDATE SET enabled=EXCLUDED.enabled,updated_by=EXCLUDED.updated_by,updated_at=CURRENT_TIMESTAMP`).bind(officeId,feature,enabled==='true'?1:0,user.id)));
    console.log(`Google: ${modules.join(', ')} ${enabled==='true'?'liberado(s)':'desativado(s)'} para o escritório ${officeId}.`);
  } finally {await database.close();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Não foi possível atualizar a liberação.');process.exitCode=1;});
