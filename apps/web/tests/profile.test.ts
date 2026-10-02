import { testDb as db } from './test-setup';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ownProfile, profileCardForEmail, readAvatar, removeAvatar, setAvatar, updateProfile } from '../src/lib/profile';
import { collaborationOverview, invite, respond } from '../src/lib/collaboration/service';
import { ensureOfficeForUser } from '../src/lib/offices';

async function person(name: string) {
  const id = randomUUID(); const email = `${id}@profile.test`;
  await db.prepare('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt","officeName") VALUES(?,?,?,false,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,?)')
    .run(id, name, email, `${name} Advocacia`);
  const office = await ensureOfficeForUser(db, { id, officeName: `${name} Advocacia` });
  return { id, email, context: { userId: id, officeId: office.officeId } };
}

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);

test('perfil salva nome e dados pessoais e aparece no card de quem pesquisa o e-mail', async () => {
  const ana = await person('Ana'); const bia = await person('Bia');
  const empty = await ownProfile(ana.id);
  assert.deepEqual([empty.headline, empty.oab, empty.bio, empty.avatarUrl], ['', '', '', null]);
  const saved = await updateProfile(ana.id, { name: '  Ana Souza ', headline: 'Advocacia trabalhista', oab: 'SP 123.456', location: 'São Paulo, SP', bio: 'Parcerias em reclamatórias.' });
  assert.equal(saved.name, 'Ana Souza');
  assert.equal((await db.prepare('SELECT name FROM "user" WHERE id=?').get<{ name: string }>(ana.id))?.name, 'Ana Souza');
  const card = await profileCardForEmail(bia.id, ana.email.toUpperCase());
  assert.equal(card?.id, ana.id);
  assert.equal(card?.headline, 'Advocacia trabalhista');
  assert.equal(card?.oab, 'SP 123.456');
  assert.equal(await profileCardForEmail(bia.id, 'ninguem@profile.test'), null);
  await assert.rejects(updateProfile(ana.id, { name: 'A', headline: '', oab: '', location: '', bio: '' }));
  await assert.rejects(updateProfile(ana.id, { name: 'Ana', headline: '', oab: '', location: '', bio: 'x'.repeat(601) }));
});

test('foto aceita só imagens reais e troca de endereço a cada envio', async () => {
  const ana = await person('Ana');
  await assert.rejects(setAvatar(ana.id, Buffer.from('<svg onload=alert(1)>'), 'image/svg+xml'), /PNG, JPEG ou WebP/);
  await assert.rejects(setAvatar(ana.id, Buffer.from('não é png'), 'image/png'), /imagem válida/);
  await assert.rejects(setAvatar(ana.id, Buffer.concat([png, Buffer.alloc(512 * 1024)]), 'image/png'), /512 KB/);
  const first = await setAvatar(ana.id, png, 'image/png');
  const second = await setAvatar(ana.id, png, 'image/png');
  assert.ok(first.avatarUrl && second.avatarUrl && first.avatarUrl !== second.avatarUrl);
  assert.deepEqual((await readAvatar(ana.id))?.avatar, png);
  assert.equal((await removeAvatar(ana.id)).avatarUrl, null);
  assert.equal(await readAvatar(ana.id), null);
});

test('consultas de e-mail têm limite por pessoa', async () => {
  const ana = await person('Ana'); const bia = await person('Bia');
  for (let i = 0; i < 60; i++) await profileCardForEmail(ana.id, `busca${i}@profile.test`);
  await assert.rejects(profileCardForEmail(ana.id, bia.email), (error: Error & { code?: string }) => error.code === 'RATE_LIMITED');
  // Another person's window is independent, and an expired window starts over.
  assert.equal((await profileCardForEmail(bia.id, ana.email))?.id, ana.id);
  await db.prepare("UPDATE profile_lookup_window SET window_start=CURRENT_TIMESTAMP-interval '11 minutes' WHERE user_id=?").run(ana.id);
  assert.equal((await profileCardForEmail(ana.id, bia.email))?.id, bia.id);
});

test('listas de associados trazem a versão da foto de cada pessoa', async () => {
  const ana = await person('Ana'); const bia = await person('Bia');
  await setAvatar(bia.id, png, 'image/png');
  const invitation = await invite(ana.context, { email: bia.email });
  await respond(bia.context, invitation.id, true);
  const overview = await collaborationOverview(ana.context);
  assert.ok(overview.associates.find(item => item.id === bia.id)?.avatarVersion);
  const mutual = await collaborationOverview(bia.context);
  assert.equal(mutual.associates.find(item => item.id === ana.id)?.avatarVersion, null);
});
