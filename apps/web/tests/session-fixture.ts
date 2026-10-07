import { randomUUID } from 'node:crypto';
import { testDb } from './test-setup';

export async function fixtureSession(userId: string) {
  const id = randomUUID();
  await testDb.prepare('INSERT INTO session(id,"userId",token,"expiresAt","createdAt","updatedAt") VALUES(?,?,?,CURRENT_TIMESTAMP+interval \'1 hour\',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)')
    .run(id,userId,randomUUID());
  return id;
}
