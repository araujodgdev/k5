import { readFileSync, copyFileSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { createRequire } from 'node:module';
const pointer = JSON.parse(readFileSync(join(tmpdir(), 'lume-verify-current.json'), 'utf8'));
const state = JSON.parse(readFileSync(join(pointer.runDir, 'state.json'), 'utf8'));
if (state.runId !== '20261006T234247-d88728' || state.port !== 62541 || state.pgPort !== 62542 || state.status !== 'ready') throw Error('Wrong instance');
const output = join(state.evidenceDir, 'source-browser');
mkdirSync(output, { recursive: true });
const t3 = join(homedir(), '.t3/userdata');
const recordings = [
 ['ebe71c58-5b5a-4ec3-a817-e658589fb5e1', 'chat-review-keyboard.mp4'],
 ['239181fd-b459-403e-941a-29e3ed379e23', 'page-edit-ask.mp4'],
 ['6fe16c69-9448-40a3-8a80-2b665ffd89f5', 'exact-publication-keyboard.mp4'],
 ['26b6af65-241e-4a43-8d1a-3c97cf298a64', 'legacy-private-archive.mp4'],
];
const files = recordings.map(([id, name]) => [join(t3,'attachments', `thread-delegated-task-command-3amcp-3aa4e3f550-3fec-4c71-a057-3626e2dc7fe9-3adel-${id}-mp4.mp4`), name]);
for (const [id,name] of [
 ['muxjx4sx-80d5bffe','chat-review-confirmed.png'],
 ['muxjwifq-4b5603d3','chat-review-desktop.png'],
 ['muxjwjm0-58c62b7f','chat-review-mobile-focused.png'],
 ['muxjwokz-113a91b0','chat-review-submitted.png'],
 ['muxio1l7-71fc8a1b','page-desktop.png'],
 ['muxio8pq-52e78009','page-mobile.png'],
 ['muxjf286-ef432e6d','publication-desktop.png'],
 ['muxjf36x-9fe0309d','publication-mobile.png'],
 ['muxjg5mq-0c7d0a68','publication-reloaded.png'],
 ['muxjp2k2-bc3c9668','archive-form-mobile.png'],
 ['muxjpq1t-3a2179f8','archive-saved-mobile.png'],
]) files.push([join(t3,'browser-artifacts',`browser-screenshot-localhost-${id}.png`),name]);
for (const [from,to] of files) copyFileSync(from,join(output,to));
const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { Client } = require('pg');
const client = new Client({ connectionString: state.databaseUrl });
await client.connect();
let database;
try {
 await client.query('BEGIN READ ONLY');
 const publication = (await client.query(`SELECT p.id,p.version,p.title,p.content,p.content_policy->>'origin' AS origin,
 p.content=a.content AS original_matches,a.version AS original_version FROM case_page p
 JOIN ai_artifact a ON a.id=$1 WHERE p.id=$2`, ['c1237288-6ddc-4921-9545-c3dc854bd4c0','233042d9-62ad-45c2-a17c-df5954aa20c1'])).rows;
 const archive = (await client.query(`SELECT d.id,d.scope,d.case_id,v.version,v.sha256,v.content_policy->>'origin' AS origin,
 v.content_policy->>'eligible' AS eligible,v.content_policy->'owners' AS owners,o.source_kind,o.source_version,
 v.content_policy->'owners' @> jsonb_build_array(o.user_id) AS owner_retained
 FROM vault_agent_origin o JOIN vault_document d ON d.id=o.document_id
 JOIN vault_document_version v ON v.document_id=d.id AND v.is_active=1 WHERE o.source_id=$1`, ['3ce4bb10-a5f7-4ec2-be0d-d4980bbafc20'])).rows;
 const chatReview = (await client.query(`SELECT a.status,p.result_page_id,p.result_version,c.content FROM capability_approval a
 JOIN case_page_approval p ON p.approval_id=a.id LEFT JOIN case_page c ON c.id=p.result_page_id WHERE a.id=$1`, ['3a093d2e-3680-4615-8b4a-13424dde3eb7'])).rows;
 await client.query('COMMIT');
 database={ publication,archive,chatReview };
} finally { await client.end(); }
writeFileSync(join(output,'persistence.json'), JSON.stringify({capturedAt:new Date().toISOString(),database},null,2));
writeFileSync(join(output,'manifest.json'), JSON.stringify({capturedAt:new Date().toISOString(),runId:state.runId,files:files.map(([from,name])=>({name,original:from,bytes:statSync(join(output,name)).size})),fixtureLevels:{publication:'Artifact created through real authenticated API; reviewed/confirmed/edited/reloaded using actual T3 controls.',archive:'Legacy model artifact arranged in disposable DB using existing e2e seed helper; DOCX archive through actual T3 controls.',ask:'Real typed ask reached unconfigured AI error; no live generation claimed.'}},null,2));
console.log(JSON.stringify({output,database}));
