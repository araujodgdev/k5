import { expect } from 'e2e';
import { admin, ApiSession } from './support/accounts';
import { test } from './support/fixtures';

test('o Cofre recebe arquivo de 100 MB e recusa um byte a mais', async ({ app, sql }) => {
  const api = await new ApiSession(app.baseUrl!).signIn(admin);
  const bytes = new Uint8Array(100 * 1024 * 1024);
  const cookie = api.cookieList.map(({ name, value }) => `${name}=${value}`).join('; ');
  const upload = async (file: File) => {
    const body = new FormData();
    body.set('file', file);
    return fetch(new URL('/api/vault/uploads', app.baseUrl!), {
      method: 'POST', body, headers: { origin: new URL(app.baseUrl!).origin, cookie },
    });
  };
  const oversized = await upload(new File([bytes, new Uint8Array([0])], 'grande.txt'));
  expect(oversized.status).toBe(400);
  expect(await oversized.json()).toMatchObject({ error: 'O arquivo excede o limite de 100 MB.' });

  const name = 'limite-100mb.txt';
  const response = await fetch(new URL('/api/vault/uploads', app.baseUrl!), {
    method: 'POST', body: new File([bytes], name),
    headers: { origin: new URL(app.baseUrl!).origin, cookie, 'x-k5-file-name': encodeURIComponent(name) },
  });
  expect(response.status).toBe(201);
  const saved = await response.json();
  expect(saved).toMatchObject({ name: 'limite-100mb.txt', byteSize: bytes.byteLength });
  expect(await sql(`SELECT r.byte_size::integer AS byte_size, r.user_id = u.id AS own_upload FROM vault_upload_ref r
    JOIN "user" u ON lower(u.email)=lower($2) WHERE r.id=$1`, [saved.uploadRef, admin.email]))
    .toEqual([{ byte_size: bytes.byteLength, own_upload: true }]);
});

test('envio direto ao Cofre preserva nome, pasta e processamento do arquivo', async ({ app, sql }) => {
  const api = await new ApiSession(app.baseUrl!).signIn(admin);
  const { case: vaultCase } = await api.json<{ case: { id: string } }>('/api/vault/cases', {
    json: { name: `Caso de upload ${Date.now()}` },
  });
  const { folder } = await api.json<{ folder: { id: string } }>('/api/vault/folders', {
    json: { name: `Uploads ${Date.now()}`, caseId: vaultCase.id, visibility: 'private' },
  });
  const name = `Procuração ${Date.now()}.txt`;
  const cookie = api.cookieList.map(({ name, value }) => `${name}=${value}`).join('; ');
  const response = await fetch(new URL('/api/vault/documents', app.baseUrl!), {
    method: 'POST', body: new File(['Documento sintético de validação do upload.'], name),
    headers: { origin: new URL(app.baseUrl!).origin, cookie, 'x-k5-file-name': encodeURIComponent(name),
      'x-k5-upload-scope': 'case', 'x-k5-upload-caseid': vaultCase.id, 'x-k5-upload-folderid': folder.id },
  });
  expect(response.status).toBe(201);
  const saved = await response.json();
  expect(saved.document).toMatchObject({ name, folderId: folder.id, caseId: vaultCase.id });
  expect(await sql('SELECT folder_id FROM vault_document WHERE id=$1', [saved.document.id]))
    .toEqual([{ folder_id: folder.id }]);
  await expect.poll(async () => (await sql('SELECT status FROM vault_document WHERE id=$1', [saved.document.id]))[0]?.status)
    .toBe('ready');
  const downloaded = await api.request(`/api/vault/documents/${saved.document.id}/download`);
  expect(downloaded.status).toBe(200);
  expect(await downloaded.text()).toBe('Documento sintético de validação do upload.');
});
