import 'server-only';
import { database } from '@/lib/database';
import { isPlatformAdmin } from '@/lib/platform-core';
import {
  createAiConnection,
  updateAiConnection,
  deleteAiConnection,
  testAiConnection,
  listAiConnections,
  listOfficesForPlatform,
  AiConnectionError,
  type AiProvider,
} from '@/lib/ai-connections-core';
import { parseCredentialKeyring } from '@/lib/platform-crypto';
import { testModelCredential } from '@/lib/ai-runtime';
import { CapabilityError } from '@/lib/capabilities/errors';
import { consumeSecretRef } from './secrets-service';
import type { WorkspaceContext } from './context';

function assertPlatformAdmin(context: WorkspaceContext) {
  if (!isPlatformAdmin(database, context.userId)) {
    throw new CapabilityError('FORBIDDEN', 'Apenas administradores da plataforma podem executar operações de plataforma.');
  }
}

export function platformListOffices(context: WorkspaceContext, input?: { limit?: number }) {
  assertPlatformAdmin(context);
  const rows = listOfficesForPlatform(database).slice(0, input?.limit ?? 50);

  return {
    offices: rows.map(r => ({
      id: String(r.id),
      name: String(r.name),
      memberCount: Number(r.connectionCount),
      createdAt: String(r.createdAt),
    })),
  };
}

export function platformListConnections(context: WorkspaceContext, input: { officeId: string }) {
  assertPlatformAdmin(context);
  const connections = listAiConnections(database, input.officeId);
  return {
    connections: connections.map(c => ({
      id: c.id,
      name: c.name,
      provider: c.provider,
      enabled: c.enabled,
      apiKeyHint: c.keyHint,
    })),
  };
}

export async function platformTestConnection(context: WorkspaceContext, input: { officeId: string; connectionId: string; task?: 'chat' | 'extraction' | 'drafting' | 'embedding' }) {
  assertPlatformAdmin(context);
  try {
    const result = await testAiConnection(database, parseCredentialKeyring(), context.userId, input.officeId, input.connectionId, input.task, testModelCredential);
    return {
      ok: true,
      message: 'Conexão verificada com sucesso.',
      modelId: result.modelId,
    };
  } catch (error) {
    if (error instanceof AiConnectionError) {
      if (error.code === 'not_found') throw new CapabilityError('NOT_FOUND', error.message);
      if (error.code === 'disabled') throw new CapabilityError('CONFLICT', error.message);
      throw new CapabilityError('INVALID', error.message);
    }
    throw error;
  }
}

/**
 * The key arrives as a reference to something a human already submitted, never as a tool
 * argument. Consuming it here is also what stops a caller from replaying the same reference.
 */
export function platformCreateConnection(context: WorkspaceContext, input: {
  officeId: string;
  name: string;
  provider: AiProvider;
  secretRef: string;
  enabled?: boolean;
  models?: { chat?: string | null; extraction?: string | null; drafting?: string | null; embedding?: string | null };
}) {
  assertPlatformAdmin(context);
  const apiKey = consumeSecretRef(context.userId, input.secretRef);
  try {
    const connection = createAiConnection(database, parseCredentialKeyring(), context.userId, input.officeId, {
      name: input.name,
      provider: input.provider,
      apiKey,
      enabled: input.enabled,
      models: input.models,
    });
    return {
      connection: {
        id: connection.id,
        name: connection.name,
        provider: connection.provider,
        enabled: connection.enabled,
        apiKeyHint: connection.keyHint,
      },
    };
  } catch (error) {
    if (error instanceof AiConnectionError) {
      if (error.code === 'conflict') throw new CapabilityError('CONFLICT', error.message);
      if (error.code === 'not_found') throw new CapabilityError('NOT_FOUND', error.message);
      throw new CapabilityError('INVALID', error.message);
    }
    throw error;
  }
}

export function platformUpdateConnection(context: WorkspaceContext, input: {
  officeId: string;
  connectionId: string;
  name?: string;
  provider?: AiProvider;
  secretRef?: string;
  enabled?: boolean;
  models?: { chat?: string | null; extraction?: string | null; drafting?: string | null; embedding?: string | null };
}) {
  assertPlatformAdmin(context);
  const apiKey = input.secretRef ? consumeSecretRef(context.userId, input.secretRef) : undefined;
  try {
    const connection = updateAiConnection(database, parseCredentialKeyring(), context.userId, input.officeId, input.connectionId, {
      name: input.name,
      provider: input.provider,
      apiKey,
      enabled: input.enabled,
      models: input.models,
    });
    return {
      connection: {
        id: connection.id,
        name: connection.name,
        provider: connection.provider,
        enabled: connection.enabled,
        apiKeyHint: connection.keyHint,
      },
    };
  } catch (error) {
    if (error instanceof AiConnectionError) {
      if (error.code === 'conflict') throw new CapabilityError('CONFLICT', error.message);
      if (error.code === 'not_found') throw new CapabilityError('NOT_FOUND', error.message);
      throw new CapabilityError('INVALID', error.message);
    }
    throw error;
  }
}

export function platformDeleteConnection(context: WorkspaceContext, input: { officeId: string; connectionId: string }) {
  assertPlatformAdmin(context);
  try {
    deleteAiConnection(database, context.userId, input.officeId, input.connectionId);
    return { success: true };
  } catch (error) {
    if (error instanceof AiConnectionError) {
      if (error.code === 'not_found') throw new CapabilityError('NOT_FOUND', error.message);
      if (error.code === 'in_use') throw new CapabilityError('CONFLICT', error.message);
      throw new CapabilityError('INVALID', error.message);
    }
    throw error;
  }
}
