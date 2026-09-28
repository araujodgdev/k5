import { randomUUID } from 'node:crypto';
import type { CapabilityName } from '../src/lib/capabilities/contracts';

const id = randomUUID();
export const workspaceCapabilityInputs: Partial<Record<CapabilityName, Record<string, unknown>>> = {
  k5_calendar_discard_pending: { eventId: id }, k5_calendar_share_event: { eventId: id, title: 'Reunião' },
  k5_calendar_unshare_event: { shareId: id }, k5_gmail_delete_draft: { draftId: id, idempotencyKey: id },
  k5_help_search: { query: 'Como registrar honorários?' },
  k5_agent_settings_get: {},
  k5_agent_settings_change: { scope: 'personal', idempotencyKey: id, change: { action: 'create_instruction', title: 'Tom', content: 'Use frases curtas.', appliesTo: 'chat', enabled: true } },
  k5_collaboration_get: {},
  k5_collaboration_change: { change: { action: 'invite', invitation: { kind: 'associate', email: 'pessoa@example.test' } } },
  k5_messages_contacts: {}, k5_messages_list: {}, k5_messages_read: { threadId: id },
  k5_messages_start: { requestId: id, recipient: { kind: 'exact_email', email: 'pessoa@example.test' } },
  k5_messages_send: { threadId: id, clientMessageId: id, body: { kind: 'text', text: 'Olá.' } },
  k5_messages_mark_read: { threadId: id, throughMessageId: id },
  k5_messages_document_options: {}, k5_messages_case_options: {},
  k5_messages_share: { threadId: id, share: { kind: 'document', documentId: id, version: 1, clientMessageId: id, idempotencyKey: id } },
  k5_messages_revoke_share: { shareId: id },
  k5_notifications_list: {}, k5_notifications_read: { notificationId: id }, k5_notifications_archive: { notificationId: id },
  k5_notifications_get_preferences: {}, k5_notifications_update_preferences: { quietEnabled: false }, k5_notifications_follow_case: { caseId: id, following: true },
  k5_honorarios_list: {}, k5_honorarios_get: { agreementId: id }, k5_honorarios_options: {},
  k5_honorarios_create: { clientId: id, title: 'Contrato', installments: [{ amountCents: 1000, dueOn: '2026-09-01' }], idempotencyKey: id },
  k5_honorarios_receive: { installmentId: id, amountCents: 1000, receivedOn: '2026-09-01', method: 'pix', idempotencyKey: id },
  k5_honorarios_reverse: { receiptId: id, reason: 'Duplicado', idempotencyKey: id }, k5_honorarios_cancel: { agreementId: id, reason: 'Encerrado', idempotencyKey: id },
  k5_research_web_search: { query: 'guarda compartilhada' }, k5_research_list_web_searches: {}, k5_research_get_web_search: { searchId: id },
  k5_research_list_history: {}, k5_research_get_search: { searchId: id }, k5_research_start_search: { theme: 'guarda compartilhada' },
  k5_research_request_page: { searchId: id }, k5_research_request_material: { judgmentId: id, kind: 'ementa' }, k5_research_cancel_downloads: { searchId: id },
  k5_research_get_profile: { caseId: id },
  k5_research_save_profile: { caseId: id, expectedVersion: 0, legalQuestion: 'Guarda compartilhada', objective: 'Definir guarda', documentedFacts: [], allegedFacts: [], gaps: [], documentIds: [] },
  k5_research_assess_material: { caseId: id, materialVersionId: id }, k5_research_get_assessment: { assessmentId: id },
  k5_research_add_reference: { caseId: id, materialVersionId: id, assessmentId: id, purpose: 'foundation' },
  k5_research_update_reference: { referenceId: id, expectedVersion: 1, notes: 'Nota' }, k5_research_remove_reference: { referenceId: id, expectedVersion: 1 },
};
