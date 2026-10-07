import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { PDFDocument, StandardFonts } from '../apps/web/node_modules/pdf-lib/es/index.js';
import { ApiSession } from '../apps/web/e2e/support/accounts';
const pointer = JSON.parse(readFileSync(join(tmpdir(), 'lume-verify-current.json'), 'utf8'));
const state = JSON.parse(readFileSync(join(pointer.runDir, 'state.json'), 'utf8'));
assert.equal(state.runId, '20261006T234247-d88728'); assert.equal(state.port, 62541); assert.equal(state.pgPort, 62542);
const api = await new ApiSession(state.baseURL).signIn({ ...state.account, name: 'Verificação' });
const { case: record } = await api.json<{ case: { id: string } }>('/api/vault/cases', { json: { name: `Round2 anexos ${Date.now()}` } });
const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
pdf.addPage().drawText('Documento de identificacao sintetico para revisao.', { font, size: 12 });
async function upload(name: string, bytes: BlobPart, mimeType: string) {
  const response = await fetch(new URL('/api/vault/documents', state.baseURL), { method: 'POST', body: new File([bytes], name, { type: mimeType }), headers: { origin: state.baseURL,
    cookie: api.cookieList.map(({ name, value }) => `${name}=${value}`).join('; '), 'x-k5-file-name': name, 'x-k5-upload-scope': 'case', 'x-k5-upload-caseid': record.id } });
  assert.equal(response.status, 201); return (await response.json()).document.id as string;
}
const scanId = await upload('preview-scan.pdf', new Uint8Array(await pdf.save()), 'application/pdf');
const petitionId = await upload('preview-petition.txt', 'O documento de identificação está juntado para comprovar os fatos narrados pela pessoa nesta petição.', 'text/plain');
for (const id of [scanId, petitionId]) {
  for (let i = 0; i < 100; i++) {
    const result = await api.json<{ document: { status: string } }>(`/api/vault/documents/${id}`);
    if (result.document.status === 'ready') break;
    assert.notEqual(i, 99); await new Promise(resolve => setTimeout(resolve, 100));
  }
}
const plan = await new Promise<string>((resolve, reject) => {
  const child = spawn(process.execPath, ['--import', 'tsx', '../../.audit/lume-annex-browser-fixture.mts', state.account.email, record.id, scanId, petitionId], { cwd: new URL('../apps/web/', import.meta.url), windowsHide: true });
  let stdout='',stderr=''; child.stdout.on('data', value => { stdout+=value; }); child.stderr.on('data', value => { stderr+=value; });
  child.on('error',reject);child.on('exit',code=>code===0?resolve(stdout):reject(new Error(stderr)));
});
const result = { caseId: record.id, scanId, petitionId, ...JSON.parse(plan.trim()), url: `${state.baseURL}/app/vault/cases/${record.id}?section=annexes` };
writeFileSync(new URL('./lume-round2-preview-case.json', import.meta.url), JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
