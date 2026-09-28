import { CapabilityError } from '@/lib/capabilities/errors';

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, ordered(item)]));
}

export function toolSignature(name: string, input: unknown) {
  return `${name}:${JSON.stringify(ordered(input))}`;
}

/** One instance per turn. A write invalidates reads; asynchronous job status remains refreshable. */
export class ToolReadGuard {
  private readonly queried = new Set<string>();

  before(name: string, input: unknown, effect: 'read' | 'write') {
    if (effect === 'write') { this.queried.clear(); return; }
    if (/^k5_(runs_get|judicial_get_job|knowledge_get_index_status|artifacts_get_verification|research_get_search|research_get_assessment)$/.test(name)) return;
    const signature = toolSignature(name, input);
    if (this.queried.has(signature)) {
      throw new CapabilityError('CONFLICT', 'Esta consulta já foi executada neste turno. Use o resultado anterior; não repita a chamada. Se faltam dados, altere um filtro relevante ou pergunte à pessoa.');
    }
    this.queried.add(signature);
  }
}
