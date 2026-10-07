import { spawn } from 'node:child_process';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { expect } from 'e2e';
import { ApiSession, uniqueAccount } from './support/accounts';
import { test, overflowsHorizontally } from './support/fixtures';
import { signInWithSession } from './support/sign-in';

test('plano persistido: revisão editada mantém vínculo, teclado e geração real em desktop e 390px', async ({ app, screen, browser, sql }) => {
  const account = uniqueAccount('Anexos vinculados'), api = await new ApiSession(app.baseUrl!).signIn(account);
  const { case: record } = await api.json<{ case: { id: string } }>('/api/vault/cases', { json: { name: 'Anexos com revisão persistente' } });
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText('Documento de identificacao sintetico para revisao dos anexos.', { font, size: 12 });
  const cookie = api.cookieList.map(({ name, value }) => `${name}=${value}`).join('; ');
  async function upload(name: string, bytes: BlobPart, mimeType: string) {
    const response = await fetch(new URL('/api/vault/documents', app.baseUrl!), { method: 'POST', body: new File([bytes], name, { type: mimeType }), headers: {
      origin: new URL(app.baseUrl!).origin, cookie, 'x-k5-file-name': encodeURIComponent(name), 'x-k5-upload-scope': 'case', 'x-k5-upload-caseid': record.id,
    } });
    expect(response.status).toBe(201); return (await response.json()).document as { id: string };
  }
  const scan = await upload('scan-revisado.pdf', new Uint8Array(await pdf.save()), 'application/pdf');
  const petition = await upload('peticao-revisada.txt', 'O documento de identificação está juntado para comprovar os fatos narrados pela pessoa nesta petição.', 'text/plain');
  for (const document of [scan, petition]) await expect.poll(async () => (await sql('SELECT status FROM vault_document WHERE id=$1', [document.id]))[0]?.status).toBe('ready');
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'e2e/support/annex-plan-fixture.mts', account.email, record.id, scan.id, petition.id], { windowsHide: true, env: process.env });
    let stdout = '', stderr = ''; child.stdout.on('data', bytes => { stdout += bytes; }); child.stderr.on('data', bytes => { stderr += bytes; });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
  });
  const planned = JSON.parse(output.trim()) as { planId: string; providerAdmissions: number };
  expect(planned.providerAdmissions).toBe(1);
  await signInWithSession({ app, screen, browser }, api);
  await app.open(`/app/vault/cases/${record.id}?section=annexes`);
  await screen.getByLabel('PDF digitalizado com os documentos').selectOption({ value: scan.id });
  await expect(screen.getByRole('heading', 'Revise antes de gerar')).toBeVisible({ timeout: 60_000 });
  await screen.getByLabel('Documento', { exact: true }).fill('Identificação editada');
  await app.screenshot('anexos-revisao-desktop');
  await browser.setViewport({ width: 390, height: 844 });
  expect(await browser.evaluate(overflowsHorizontally)).toBe(false);
  await screen.getByRole('button', 'Gerar 1 anexo').scrollIntoView();
  await screen.getByRole('button', 'Gerar 1 anexo').focus(); await app.screenshot('anexos-revisao-mobile');
  await browser.keyboard.press('Enter');
  await expect(screen.getByRole('heading', 'Anexos gerados')).toBeVisible({ timeout: 60_000 });
  await expect(screen.getByRole('link', '01_identificacao_editada.pdf')).toBeVisible();
  const rows = await sql<{ id: string; content_policy: { observed: { id: string }[] } }>(`SELECT d.id,v.content_policy FROM vault_document d JOIN vault_document_version v ON v.document_id=d.id AND v.is_active=1 WHERE d.case_id=$1 AND d.original_name='01_identificacao_editada.pdf'`, [record.id]);
  expect(rows).toHaveLength(1);
  expect(rows[0].content_policy.observed.map(pin => pin.id)).toContain(petition.id);
  expect(await sql('SELECT id FROM annex_plan WHERE id=$1', [planned.planId])).toHaveLength(1);
  expect((await api.request(`/api/vault/documents/${rows[0].id}/download`)).status).toBe(200);
  await app.screenshot('anexos-gerados-mobile');
  await app.open(`/app/vault/cases/${record.id}?section=annexes`);
  await screen.getByLabel('PDF digitalizado com os documentos').selectOption({ value: scan.id });
  await expect(screen.getByLabel('Documento', { exact: true })).toHaveValue('Identificação revisada');
  const replacement = await fetch(new URL('/api/vault/uploads', app.baseUrl!), { method: 'POST', body: new File([new Uint8Array(await pdf.save())], 'scan-v2.pdf', { type: 'application/pdf' }), headers: { origin: new URL(app.baseUrl!).origin, cookie, 'x-k5-file-name': 'scan-v2.pdf' } });
  expect(replacement.status).toBe(201);
  await api.json(`/api/vault/documents/${scan.id}/versions`, { json: { uploadRef: (await replacement.json()).uploadRef } });
  await screen.getByRole('button', 'Gerar 1 anexo').tap();
  await expect(screen.getByRole('alert').filter({ hasText: 'O PDF mudou depois da análise' })).toBeVisible();
  await app.screenshot('anexos-versao-alterada-mobile');
});
