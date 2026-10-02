import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { postgresFixture } from './postgres-fixture';
import { checkAssociateMemberships, migratePostgres } from '../src/lib/db/migrate';

test('associate migration refuses incompatible legacy memberships without changing their data or schema', async () => {
  const { pool } = await postgresFixture();
  assert.deepEqual(await checkAssociateMemberships(pool), { usersWithMultipleOffices: 0, officesWithMultipleMembers: 0 });
  // Restore the membership shape that an existing pre-refactor database has.
  await pool.query(`ALTER TABLE office_member DROP CONSTRAINT office_member_user_unique;
    ALTER TABLE office_member DROP CONSTRAINT office_member_office_unique;
    ALTER TABLE office_member ADD COLUMN role TEXT DEFAULT 'lawyer';
    DELETE FROM postgres_migration WHERE name IN ('0059_associate_access.sql','0060_folder_access_fail_closed.sql')`);
  const one = randomUUID(), two = randomUUID(), first = randomUUID(), second = randomUUID();
  await pool.query('INSERT INTO "user"(id,email,name) VALUES($1,$2,$3),($4,$5,$6)', [one, `${one}@migration.test`, 'Ana', two, `${two}@migration.test`, 'Bia']);
  await pool.query('INSERT INTO office(id,name) VALUES($1,$2),($3,$4)', [first, 'Primeiro', second, 'Segundo']);
  await pool.query('INSERT INTO office_member(id,office_id,user_id) VALUES($1,$2,$3),($4,$5,$6),($7,$8,$9)', [randomUUID(), first, one, randomUUID(), second, one, randomUUID(), first, two]);
  await assert.rejects(checkAssociateMemberships(pool), /1 usuários em vários escritórios e 1 escritórios com vários membros/);
  await assert.rejects(migratePostgres(pool, new URL('../db/postgres/', import.meta.url)), /Migração de associados bloqueada/);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM office_member')).rows[0].n, 3);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='office_member' AND column_name='role'")).rows[0].n, 1);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM postgres_migration WHERE name='0059_associate_access.sql'")).rows[0].n, 0);
});
