import pg from '../../../apps/web/node_modules/pg/lib/index.js';
process.loadEnvFile('.env.postgres.local');
const c=new pg.Client({connectionString:process.env.PROCESSOR_DATABASE_URL});
try {await c.connect(); console.log(JSON.stringify((await c.query("SELECT id,court_code,enabled FROM judicial_source_installation ORDER BY court_code")).rows)); console.log(JSON.stringify((await c.query("SELECT p.* FROM research_crawl_partition p JOIN judicial_source_installation i ON i.id=p.installation_id WHERE i.court_code='TJPE'")).rows));} finally {await c.end();}

