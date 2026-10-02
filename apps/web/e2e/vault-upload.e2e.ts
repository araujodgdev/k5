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

  const response = await upload(new File([bytes], 'limite-100mb.txt'));
  expect(response.status).toBe(201);
  const saved = await response.json();
  expect(saved).toMatchObject({ name: 'limite-100mb.txt', byteSize: bytes.byteLength });
  expect(await sql(`SELECT r.byte_size::integer AS byte_size, r.user_id = u.id AS own_upload FROM vault_upload_ref r
    JOIN "user" u ON lower(u.email)=lower($2) WHERE r.id=$1`, [saved.uploadRef, admin.email]))
    .toEqual([{ byte_size: bytes.byteLength, own_upload: true }]);
});
