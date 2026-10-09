import 'server-only';
import { randomUUID } from 'node:crypto';
import { ApiError } from '@/lib/api-error';
import { withTransaction, type Transaction } from '@/lib/database';

declare const capturedOrigin: unique symbol;
export type BillingOrigin = Readonly<{ id: string; officeId: string; userId: string; conversationId: string; [capturedOrigin]: true }>;
export type BillingOwner = { officeId: string; userId: string | null; billingOrigin?: BillingOrigin | null };

export async function captureBillingOrigin(owner: { officeId: string; userId: string }, conversationId: string): Promise<BillingOrigin> {
  return withTransaction(async tx => {
    const conversation = await tx.prepare('SELECT id FROM ai_conversation WHERE id=? AND office_id=? AND user_id=? FOR SHARE')
      .get(conversationId, owner.officeId, owner.userId);
    if (!conversation) throw new ApiError(404, 'Conversa não encontrada.');
    const row = await tx.prepare(`INSERT INTO billing_origin(id,office_id,user_id,conversation_id) VALUES(?,?,?,?)
      ON CONFLICT(office_id,user_id,conversation_id) DO UPDATE SET conversation_id=excluded.conversation_id RETURNING id`)
      .get<{ id: string }>(randomUUID(), owner.officeId, owner.userId, conversationId);
    return { id: row!.id, ...owner, conversationId } as BillingOrigin;
  });
}

export async function persistedBillingOrigin(tx: Transaction, owner: { officeId: string; userId: string | null }, id?: string | null): Promise<BillingOrigin | null> {
  if (!id || !owner.userId) return null;
  const row = await tx.prepare(`SELECT id,office_id AS "officeId",user_id AS "userId",conversation_id AS "conversationId"
    FROM billing_origin WHERE id=? AND office_id=? AND user_id=?`).get<{ id: string; officeId: string; userId: string; conversationId: string }>(id, owner.officeId, owner.userId);
  return row ? row as BillingOrigin : null;
}

export async function billingOwner(tx: Transaction, owner: BillingOwner): Promise<BillingOwner> {
  const captured = owner.billingOrigin;
  const origin = captured?.userId === owner.userId
    ? await persistedBillingOrigin(tx, { officeId: captured.officeId, userId: owner.userId }, captured.id) : null;
  return origin ? { officeId: origin.officeId, userId: origin.userId, billingOrigin: origin } : { officeId: owner.officeId, userId: owner.userId };
}

export async function restoreBillingOrigin(tx: Transaction, userId: string | null, id?: string | null): Promise<BillingOrigin | null> {
  if (!userId || !id) return null;
  const row = await tx.prepare(`SELECT id,office_id AS "officeId",user_id AS "userId",conversation_id AS "conversationId" FROM billing_origin WHERE id=? AND user_id=?`)
    .get<{id:string;officeId:string;userId:string;conversationId:string}>(id,userId);
  return row ? row as BillingOrigin : null;
}
