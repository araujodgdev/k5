import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database, type Transaction } from '@/lib/database';
import type { WorkspaceContext } from '@/lib/application/context';
import { CapabilityError } from '@/lib/capabilities/errors';
import { assertPolicyAccess, combinePolicy, contentDigest, observeVaultFile, parsePolicy, personPolicy, type ContentPolicy } from '@/lib/content-policy';
import { contentResult, payloadDigest, canonicalContent, type ContentIdentity } from '@/lib/content-result';
import { ownedContentResult } from '@/lib/content-result';
import { canonicalInput, createApprovalProposal, type ApprovalRow } from '@/lib/application/approvals-service';
import type { CapabilityName } from '@/lib/capabilities/contracts';
import { profileText, type ProfileText, type ProfileView, type ResearchGeneration, RESEARCH_SCHEMA_VERSION } from './case-content-contract';
export { profileText, personProfileText, researchTextChange, profileView, RESEARCH_SCHEMA_VERSION } from './case-content-contract';
export type { ProfileView, ResearchTextChange, ResearchGeneration } from './case-content-contract';

type Scalar = 'legalQuestion' | 'objective' | 'thesis';
type List = 'documentedFacts' | 'allegedFacts' | 'gaps' | 'documentIds';
type PartKind = Scalar | List;
const kinds = ['legalQuestion', 'objective', 'thesis', 'documentedFacts', 'allegedFacts', 'gaps', 'documentIds'] as const;
export type ResearchPart = { id: string; kind: PartKind; value: unknown; digest: string; policy: ContentPolicy | null; receipt: string };
const partsSchema = z.array(z.object({ id: z.uuid(), kind: z.enum(kinds), value: z.unknown(), digest: z.string(), policy: z.unknown(), receipt: z.string() })).max(183);
const conflict = () => new CapabilityError('CONFLICT', 'O perfil ou sua revisão mudou. Reabra o perfil antes de salvar.');
const values = (profile: ProfileText, kind: PartKind) => ['legalQuestion','objective','thesis'].includes(kind) ? [profile[kind as Scalar]] : profile[kind as List];

export function validateResearchParts(raw: unknown, profile: ProfileText): ResearchPart[] | null {
  if (!raw) return null;
  const parsed = partsSchema.safeParse(raw);
  if (!parsed.success || new Set(parsed.data.map(part => part.id)).size !== parsed.data.length) throw conflict();
  const parts = parsed.data.map(part => ({ ...part, policy: part.policy === null ? null : parsePolicy(part.policy, contentDigest('', canonicalContent(part.value))) }));
  for (const kind of kinds) {
    const selected = parts.filter(part => part.kind === kind);
    if (payloadDigest(selected.map(part => part.value)) !== payloadDigest(values(profile, kind)) || selected.some(part => part.digest !== payloadDigest(part.value))) throw conflict();
  }
  return parts;
}

async function seed(context: WorkspaceContext, caseId: string, version: number, parts: ResearchPart[], db: Transaction) {
  const scope = { caseId, version, partIds: parts.map(part => part.id), partDigests: parts.map(part => [part.id,part.digest]) };
  const policy = combinePolicy('', JSON.stringify(scope), parts.flatMap(part => part.policy ? [part.policy] : []), 'person');
  const id = randomUUID();
  await db.prepare("INSERT INTO content_seed(id,office_id,user_id,purpose,scope,digest,content_policy) VALUES(?,?,?,'research-profile',?::jsonb,?,?::jsonb)")
    .run(id, context.officeId, context.userId, JSON.stringify(scope), payloadDigest(scope), JSON.stringify(policy));
  return id;
}

export async function projectProfile(context: WorkspaceContext, metadata: { caseId: string; version: number; updatedAt: string; updatedBy: string },
  profile: ProfileText, rawParts: unknown, db: Transaction = database): Promise<ProfileView> {
  const parts = validateResearchParts(rawParts, profile);
  const shown: ResearchPart[] = [];
  for (const part of parts ?? []) {
    if (!part.policy) continue;
    try { await assertPolicyAccess(context.userId, part.policy, db); shown.push(part); }
    catch (error) { if (!(error instanceof CapabilityError)) throw error; }
  }
  const documentIds: string[] = [];
  for (const part of shown.filter(part => part.kind === 'documentIds')) {
    try { await observeVaultFile(context.userId, String(part.value), db); documentIds.push(String(part.value)); }
    catch (error) { if (!(error instanceof CapabilityError)) throw error; }
  }
  const editable = shown.filter(part => part.kind !== 'documentIds' || documentIds.includes(String(part.value)));
  const get = (kind: PartKind) => editable.filter(part => part.kind === kind);
  const documented = get('documentedFacts').filter(part => (part.value as ProfileText['documentedFacts'][number]).documentIds.every(id => documentIds.includes(id)));
  const actualShown = editable.filter(part => part.kind !== 'documentedFacts' || documented.includes(part));
  const readToken = await seed(context, metadata.caseId, metadata.version, actualShown, db);
  const entries = { documentedFacts: documented.map(part => part.id), allegedFacts: get('allegedFacts').map(part => part.id), gaps: get('gaps').map(part => part.id) };
  const lists = { documentedFacts: documented.map(part => part.value) as ProfileText['documentedFacts'], allegedFacts: get('allegedFacts').map(part => part.value) as string[], gaps: get('gaps').map(part => part.value) as string[], documentIds };
  const common = { ...metadata, readToken, entryIds: entries, ...lists };
  const scalars = Object.fromEntries(['legalQuestion','objective','thesis'].map(kind => {
    const part = get(kind as Scalar)[0];
    return [kind, part ? { state: 'visible', value: part.value } : { state: 'withheld' }];
  })) as Extract<ProfileView,{kind:'restricted'}>['scalars'];
  const complete = parts && actualShown.length === parts.length;
  const value: ProfileView = complete ? { ...common, kind: 'complete', legalQuestion: profile.legalQuestion, objective: profile.objective, thesis: profile.thesis }
    : { ...common, kind: 'restricted', scalars, withheld: { documentedFacts: profile.documentedFacts.length - lists.documentedFacts.length,
      allegedFacts: profile.allegedFacts.length-lists.allegedFacts.length, gaps: profile.gaps.length-lists.gaps.length, documentIds: profile.documentIds.length-documentIds.length } };
  return contentResult(value, [{ ...personPolicy('', ''), guards: [{ kind: 'case', id: metadata.caseId }] }, ...actualShown.flatMap(part => part.policy ? [part.policy] : [])], actualShown.map(part => ({ kind: `research-${part.kind}`, id: part.id, version: metadata.version, digest: part.digest })));
}

export async function profilePartsForSave(context: WorkspaceContext, caseId: string, version: number, input: Partial<ProfileText> & { readToken?: string; entryIds?: { documentedFacts: (string|null)[]; allegedFacts: (string|null)[]; gaps: (string|null)[] }; deletedEntryIds?: string[] },
  previous: ProfileText | null, rawParts: unknown, generated?: ContentPolicy, db: Transaction = database) {
  const previousParts = previous ? validateResearchParts(rawParts, previous) ?? kinds.flatMap(kind => values(previous, kind).map(value => ({
    id: randomUUID(), kind, value, digest: payloadDigest(value), policy: null, receipt: 'legacy-unknown',
  }))) : [];
  let admittedSeed: ContentPolicy | undefined;
  let shownIds = new Set<string>();
  if (input.readToken) {
    const row = await db.prepare("SELECT scope,digest,content_policy FROM content_seed WHERE id=? AND office_id=? AND user_id=? AND purpose='research-profile'")
      .get<{ scope: { caseId: string; version: number; partIds: string[]; partDigests: [string,string][] }; digest: string; content_policy: unknown }>(input.readToken,context.officeId,context.userId);
    if (!row || row.scope.caseId !== caseId || row.scope.version !== version || row.digest !== payloadDigest(row.scope)) throw conflict();
    if (row.scope.partDigests.some(([id,digest]) => !previousParts?.some(part => part.id === id && part.digest === digest))) throw conflict();
    admittedSeed = parsePolicy(row.content_policy); await assertPolicyAccess(context.userId, admittedSeed, db);
    shownIds = new Set(row.scope.partIds);
  } else if (previous && !generated) throw conflict();
  const deleted = new Set(input.deletedEntryIds ?? []);
  if (deleted.size !== (input.deletedEntryIds ?? []).length) throw conflict();
  if (input.entryIds && (['documentedFacts','allegedFacts','gaps'] as const).some(kind => input.entryIds![kind].length !== input[kind]?.length)) throw conflict();
  if ([...deleted].some(id => !shownIds.has(id))) throw conflict();
  const listKinds = ['documentedFacts','allegedFacts','gaps'] as const;
  if (input.readToken && previousParts.some(part => deleted.has(part.id) && listKinds.some(kind => kind === part.kind)) &&
      listKinds.some(kind => input[kind]?.some((_, index) => !input.entryIds?.[kind][index]))) throw conflict();
  const used = new Set<string>();
  const parts: ResearchPart[] = [];
  const make = async (kind: PartKind, value: unknown, prior?: ResearchPart) => {
    const digest = payloadDigest(value), receipt = randomUUID();
    const documents = kind === 'documentedFacts' ? (value as ProfileText['documentedFacts'][number]).documentIds : kind === 'documentIds' ? [String(value)] : [];
    const sources = await Promise.all(documents.map(id => observeVaultFile(context.userId,id,db).then(source => source.policy)));
    const policy = prior?.digest === digest && prior.kind === kind ? prior.policy
      : combinePolicy('', canonicalContent(value), [...sources, ...(generated ? [generated] : prior ? [...(prior.policy ? [prior.policy] : []), ...(admittedSeed ? [admittedSeed] : [])] : [])], generated ? 'generated' : 'person', receipt);
    parts.push({ id: prior?.id ?? randomUUID(), kind, value, digest, policy, receipt: prior?.digest === digest && prior.kind === kind ? prior.receipt : receipt });
  };
  for (const kind of kinds) {
    if (input[kind] === undefined) {
      parts.push(...previousParts?.filter(part => part.kind === kind) ?? []);
      continue;
    }
    for (const [index,value] of values(input as ProfileText, kind).entries()) {
      const isScalar = ['legalQuestion','objective','thesis'].includes(kind);
      const id = isScalar ? previousParts?.find(part => part.kind === kind)?.id : kind === 'documentIds'
        ? previousParts?.find(part => part.kind === kind && part.value === value)?.id : input.entryIds?.[kind as keyof NonNullable<typeof input.entryIds>]?.[index];
      const prior = id ? previousParts?.find(part => part.id === id) : undefined;
      if (id && (!prior || used.has(id) || !generated && !shownIds.has(id))) throw conflict();
      if (prior && prior.kind !== kind && !(['documentedFacts','allegedFacts'].includes(prior.kind) && ['documentedFacts','allegedFacts'].includes(kind))) throw conflict();
      if (!id && input.readToken && previousParts?.some(part => shownIds.has(part.id) && part.digest === payloadDigest(value))) throw conflict();
      if (id) used.add(id);
      await make(kind, value, prior);
    }
  }
  if (input.readToken) {
    if ([...shownIds].some(id => previousParts?.find(part => part.id === id)?.kind !== 'documentIds' && !parts.some(part => part.id === id) && !deleted.has(id))) throw conflict();

    parts.push(...previousParts?.filter(part => !shownIds.has(part.id) && !parts.some(next => next.id === part.id)) ?? []);
  }
  const profile = Object.fromEntries(kinds.map(kind => [kind, ['legalQuestion','objective','thesis'].includes(kind)
    ? parts.find(part => part.kind === kind)?.value : parts.filter(part => part.kind === kind).map(part => part.value)])) as ProfileText;
  return { profile: profileText.parse(profile), parts };
}

export function researchGenerationSchema(specification: ResearchGeneration) {
  return specification.kind === 'profile' ? profileText : z.object({ notes: z.string().trim().max(4000) });
}
export type ResearchGenerationReceipt = { kind: 'profile' | 'notes'; schemaVersion: 1; target: ResearchGeneration; generationAttemptId: string;
  inputDigest: string; outputDigest: string; output: ProfileText | { notes: string }; fieldPolicy: ContentPolicy };
export function researchGenerationReceipt(specification: ResearchGeneration, attemptId: string, inputDigest: string, content: string, policy: ContentPolicy): ResearchGenerationReceipt {
  const output = researchGenerationSchema(specification).parse(JSON.parse(content));
  return { kind: specification.kind, schemaVersion: RESEARCH_SCHEMA_VERSION, target: specification, generationAttemptId: attemptId, inputDigest,
    outputDigest: payloadDigest(output), output, fieldPolicy: policy };
}

export async function prepareResearchChange(context: WorkspaceContext, operation: CapabilityName, target: Record<string, unknown>, specification: ResearchGeneration,
  approvalId?: string, change?: { kind: string; generationAttemptId?: string }) {
  if (!context.invocation) throw new CapabilityError('INVALID', 'Esta preparação exige um pedido registrado na conversa.');
  if (!approvalId) {
    if (change?.kind && change.kind !== 'request') throw new CapabilityError('FORBIDDEN', 'Envie um novo pedido para preparar este conteúdo.');
    const { prepareSharedWriting } = await import('@/lib/documents/shared-writing');
    const output = await prepareSharedWriting(context, operation, target, specification);
    const receipt = researchGenerationReceipt(specification, output.attemptId, '', output.content, output.policy);
    const proposal = await import('@/lib/documents/service').then(({ documentTransaction }) => documentTransaction(context, async tx => {
      const attempt = await tx.prepare("SELECT input_digest,approval_id FROM content_generation_attempt WHERE id=? AND state='ready' FOR UPDATE")
        .get<{ input_digest: string; approval_id: string | null }>(output.attemptId);
      if (!attempt) throw conflict();
      if (attempt.approval_id) return attempt.approval_id;
      receipt.inputDigest = attempt.input_digest;
      const payload = { ...target, change: { kind: 'confirm', generationAttemptId: output.attemptId } };
      const row = await createApprovalProposal(context, operation, payload, specification.caseId, specification.expectedVersion, 600_000, tx);
      await tx.prepare('UPDATE capability_approval SET content_policy=?::jsonb,content_result=?::jsonb WHERE id=?')
        .run(JSON.stringify(output.policy), JSON.stringify(receipt), row.id);
      await tx.prepare('UPDATE content_generation_attempt SET approval_id=? WHERE id=?').run(row.id, output.attemptId);
      return row.id;
    }));
    throw new CapabilityError('APPROVAL_REQUIRED', `Revise o conteúdo preparado antes de compartilhar. Proposta registrada [id: ${proposal}].`);
  }
  const row = await database.prepare('SELECT * FROM capability_approval WHERE id=? AND office_id=? AND user_id=?')
    .get<ApprovalRow>(approvalId, context.caseScope?.homeOfficeId ?? context.officeId,context.userId);
  if (!row || row.capability_name !== operation || !change?.generationAttemptId || row.normalized_input !== canonicalInput({ ...target, change })) throw conflict();
  if (!['approved','consumed'].includes(row.status) || row.status !== 'consumed' && row.expires_at < Date.now()) throw conflict();
  const attempt = await database.prepare(`SELECT a.input_digest,a.output,a.content_policy,a.target FROM content_generation_attempt a JOIN content_submission s ON s.id=a.submission_id
    WHERE a.id=? AND a.approval_id=? AND a.state='ready' AND s.user_id=? AND s.office_id=? AND s.id=? AND a.generation_id=? AND s.conversation_id=?`)
    .get<{ input_digest: string; output: { content: string }; content_policy: unknown; target: Record<string,unknown> }>(change.generationAttemptId, row.id,context.userId,
      context.caseScope?.homeOfficeId ?? context.officeId,context.submissionId,context.generationId,context.conversationId);
  if (!attempt || canonicalInput(attempt.target) !== canonicalInput({ ...target, research: specification, schemaVersion: RESEARCH_SCHEMA_VERSION })) throw conflict();
  const policy = parsePolicy(attempt.content_policy); await assertPolicyAccess(context.userId, policy);
  const receipt = researchGenerationReceipt(specification, change.generationAttemptId, attempt.input_digest, attempt.output.content, policy);
  if (row.status !== 'consumed' && canonicalContent(row.content_result) !== canonicalContent(receipt)) throw conflict();
  return { receipt, approval: row };
}

export async function consumedResearchResult(context: WorkspaceContext, approval: ApprovalRow, db: Transaction) {
  if (approval.status !== 'consumed') return undefined;
  const saved = approval.content_result as { value?: object; policies?: unknown[]; identities?: ContentIdentity[]; payloadDigest?: string };
  if (!saved?.value || !saved.policies || saved.payloadDigest !== payloadDigest(saved.value)) throw conflict();
  const policies = saved.policies.map(policy => parsePolicy(policy));
  for (const policy of policies) await assertPolicyAccess(context.userId, policy, db);
  return contentResult(saved.value, policies, saved.identities ?? []);
}

export async function consumeResearchChange(approval: ApprovalRow, result: object, db: Transaction) {
  const consumed = await db.prepare("UPDATE capability_approval SET status='consumed',content_result=?::jsonb,consumed_at=CURRENT_TIMESTAMP WHERE id=? AND status='approved' AND expires_at>=?")
    .run(JSON.stringify(ownedContentResult(result)), approval.id, Date.now());
  if (!consumed.changes) throw conflict();
}

export async function researchApprovalPreview(context: WorkspaceContext, approvalId: string) {
  const { getApprovalProposal } = await import('@/lib/application/approvals-service');
  const { assertCapabilityAllowed } = await import('@/lib/application/context');
  const row = await getApprovalProposal(context,approvalId);
  const input = JSON.parse(row.normalized_input) as { change?: { kind: string; generationAttemptId?: string } };
  if (!input.change || input.change.kind !== 'confirm' || !input.change.generationAttemptId || !row.capability_name.startsWith('k5_research_')) throw conflict();
  const attempt = await database.prepare("SELECT target,output,content_policy,input_digest FROM content_generation_attempt WHERE id=? AND approval_id=? AND state='ready'")
    .get<{ target: { research: ResearchGeneration }; output: { content: string }; content_policy: unknown; input_digest: string }>(input.change.generationAttemptId,row.id);
  if (!attempt?.target.research) throw conflict();
  const scoped = await import('@/lib/collaboration/access').then(({ contextForCase }) => contextForCase(context,attempt.target.research.caseId));
  await assertCapabilityAllowed(scoped,row.capability_name as CapabilityName);
  const policy = parsePolicy(attempt.content_policy); await assertPolicyAccess(context.userId,policy);
  const receipt = researchGenerationReceipt(attempt.target.research,input.change.generationAttemptId,attempt.input_digest,attempt.output.content,policy);
  if (row.status !== 'consumed' && canonicalContent(row.content_result) !== canonicalContent(receipt)) throw conflict();
  const profile = receipt.kind === 'profile' ? receipt.output as ProfileText : null;
  const content = profile ? [`Questão jurídica: ${profile.legalQuestion}`, `Objetivo: ${profile.objective}`, `Tese: ${profile.thesis ?? 'Sem tese'}`,
    'Fatos documentados:', ...profile.documentedFacts.map(fact => `• ${fact.text}\n  Documentos: ${fact.documentIds.join(', ')}\n  Trechos: ${fact.chunkIds.join(', ') || 'Nenhum'}`), 'Fatos alegados:', ...profile.allegedFacts.map(text => `• ${text}`),
    'Lacunas:', ...profile.gaps.map(text => `• ${text}`), 'Documentos selecionados:', ...profile.documentIds].join('\n') : (receipt.output as { notes: string }).notes;
  const caseRow = await database.prepare('SELECT name FROM vault_case WHERE id=?').get<{ name: string }>(receipt.target.caseId);
  return { title: profile ? 'Perfil para comparação' : 'Anotação da referência', content, destination: caseRow?.name ?? 'Caso',
    audience: 'Participantes do caso com acesso a todas as fontes utilizadas.', version: receipt.target.expectedVersion };
}
