import 'server-only';
import { withTransaction, type Transaction } from './database';

export async function lockAclMutation(tx: Transaction) {
  await tx.prepare("SELECT pg_advisory_xact_lock(hashtextextended('lume:content-acl:' || current_schema(),0))").get();
}

export function aclTransaction<T>(action: (tx: Transaction) => Promise<T>) {
  return withTransaction(async tx => {
    await lockAclMutation(tx);
    return action(tx);
  });
}

export function aclReadTransaction<T>(action: (tx: Transaction) => Promise<T>) {
  return withTransaction(async tx => {
    await tx.prepare("SELECT pg_advisory_xact_lock_shared(hashtextextended('lume:content-acl:' || current_schema(),0))").get();
    return action(tx);
  });
}
