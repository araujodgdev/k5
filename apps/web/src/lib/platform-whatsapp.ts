import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database, withTransaction, type Database } from './database';
import { assertPlatformAdmin, PlatformRequestError } from './platform-core';
import { whatsappEnvironment } from './whatsapp/environment';
import { readLimitedJson, whatsappTransport } from './whatsapp/transport';

const flagKey = 'whatsapp-integration';
const ruleSchema = z.looseObject({
  priority: z.number().int().positive(), conditions: z.array(z.json()), serve_variation: z.string(),
  rollout: z.object({ percentage: z.number(), attribute: z.string().optional() }).optional(),
});
const flagSchema = z.object({
  key: z.literal(flagKey), enabled: z.boolean(), default_variation: z.string(),
  variations: z.record(z.string(), z.boolean()), rules: z.array(ruleSchema),
  description: z.string().nullable().optional(),
});
type Flag = z.infer<typeof flagSchema>;
const exactOfficeCondition = z.object({ attribute: z.literal('office_id'), operator: z.literal('equals'), value: z.string() });

function configuration() {
  const env = whatsappEnvironment();
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.FLAGSHIP_APP_ID || !env.FLAGSHIP_MANAGE_TOKEN) {
    throw new PlatformRequestError(503, 'A gestão do WhatsApp ainda não foi configurada neste ambiente.');
  }
  return { appId: env.FLAGSHIP_APP_ID, accountId: env.CLOUDFLARE_ACCOUNT_ID, token: env.FLAGSHIP_MANAGE_TOKEN };
}

async function requestFlagship(path: string, body?: Flag): Promise<unknown> {
  const { accountId, appId, token } = configuration();
  try {
    const response = await whatsappTransport()(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/flagship/apps/${encodeURIComponent(appId)}/${path}`,
      { method: body ? 'PUT' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000) },
    );
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error('Flagship request failed');
    }
    return await readLimitedJson(response, 1_048_576);
  } catch {
    throw new PlatformRequestError(502, body
      ? 'Não foi possível confirmar a alteração. Atualize o estado antes de tentar novamente.'
      : 'Não foi possível consultar o WhatsApp. Tente atualizar o estado.');
  }
}

async function readFlag() {
  const result = z.object({ success: z.literal(true), result: flagSchema }).safeParse(await requestFlagship(`flags/${flagKey}`));
  if (!result.success) throw new PlatformRequestError(502, 'A configuração do WhatsApp não pôde ser consultada.');
  return result.data.result;
}

const revision = (flag: Flag) => createHash('sha256').update(JSON.stringify(flag)).digest('hex');

async function assertOffice(db: Pick<Database, 'prepare'>, actorId: string, officeId: string) {
  await assertPlatformAdmin(db, actorId);
  if (!await db.prepare('SELECT id FROM office WHERE id=?').get(officeId)) throw new PlatformRequestError(404, 'Cliente não encontrado.');
}

export async function platformWhatsAppStatus(actorId: string, officeId: string) {
  await assertOffice(database, actorId, officeId);
  const flag = await readFlag();
  const query = new URLSearchParams({ flagKey, office_id: officeId, targetingKey: officeId });
  const result = z.object({ flagKey: z.literal(flagKey), value: z.boolean() }).safeParse(await requestFlagship(`evaluate?${query}`));
  if (!result.success) throw new PlatformRequestError(502, 'Não foi possível verificar a ativação do WhatsApp.');
  return { enabled: result.data.value, globalEnabled: flag.enabled, revision: revision(flag) };
}

export async function setPlatformWhatsApp(actorId: string, officeId: string, enabled: boolean, expectedRevision: string) {
  await assertOffice(database, actorId, officeId);
  const { accountId, appId } = configuration();
  await withTransaction(async tx => {
    await tx.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?,0))').get(`flagship:${accountId}:${appId}:${flagKey}`);
    await assertOffice(tx, actorId, officeId);
    const flag = await readFlag();
    if (revision(flag) !== expectedRevision) throw new PlatformRequestError(409, 'A configuração mudou. Atualize o estado antes de salvar.');
    if (!flag.enabled) throw new PlatformRequestError(409, 'O WhatsApp está pausado para todos os escritórios. Reative o controle geral no Flagship primeiro.');
    const variation = Object.entries(flag.variations).find(([, value]) => value === enabled)?.[0];
    if (!variation) throw new PlatformRequestError(409, 'A variação necessária não está configurada no Flagship.');
    const others = flag.rules.filter(rule => {
      if (rule.rollout || rule.conditions.length !== 1) return true;
      const condition = exactOfficeCondition.safeParse(rule.conditions[0]);
      return !condition.success || condition.data.value !== officeId;
    }).sort((a, b) => a.priority - b.priority);
    const updated: Flag = { ...flag, rules: [
      { priority: 1, conditions: [{ attribute: 'office_id', operator: 'equals', value: officeId }], serve_variation: variation },
      ...others.map((rule, index) => ({ ...rule, priority: index + 2 })),
    ] };
    const result = z.object({ success: z.literal(true), result: flagSchema }).safeParse(await requestFlagship(`flags/${flagKey}`, updated));
    if (!result.success) throw new PlatformRequestError(502, 'Não foi possível confirmar a alteração. Atualize o estado.');
    await tx.prepare('INSERT INTO platform_audit_log(id,actor_user_id,office_id,action,details_json) VALUES(?,?,?,?,?)')
      .run(randomUUID(), actorId, officeId, 'whatsapp.rollout.updated', JSON.stringify({ enabled, appId, flagKey }));
  });
}
