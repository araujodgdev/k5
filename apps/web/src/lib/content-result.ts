import 'server-only';
import { createHash } from 'node:crypto';
import { exposeContent, exposedPolicies, exposedSourcePolicies, type ContentPolicy } from './content-policy';

export type ContentIdentity = { kind: string; id: string; version: string | number; digest: string };
export type ContentResult<T> = { value: T; policies: readonly ContentPolicy[]; identities: readonly ContentIdentity[]; payloadDigest: string };
const results = new WeakMap<object, ContentResult<unknown>>();
export function canonicalContent(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).filter(([,value]) => value !== undefined)
      .sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([key,value]) => [key,normalize(value)]));
    return item;
  };
  return JSON.stringify(normalize(value));
}
export const payloadDigest = (value: unknown) => createHash('sha256').update(canonicalContent(value)).digest('hex');

export function contentResult<T extends object>(value: T, policies: readonly ContentPolicy[], identities: readonly ContentIdentity[] = []): T {
  const freeze = <U>(item: U): U => {
    if (item && typeof item === 'object') {
      for (const child of Object.values(item)) freeze(child);
      Object.freeze(item);
    }
    return item;
  };
  const pinnedPolicies = freeze(structuredClone(policies));
  const pinnedIdentities = freeze(structuredClone(identities));
  results.set(value, Object.freeze({ value, policies: pinnedPolicies, identities: pinnedIdentities, payloadDigest: payloadDigest(value) }));
  return exposeContent(value, [...pinnedPolicies]);
}

export function ownedContentResult(value: unknown): ContentResult<unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const result = results.get(value);
  if (result && result.payloadDigest !== payloadDigest(value)) throw new Error('Content result changed after observation.');
  return result;
}

/** Explicit mappings carry owner evidence without discovering policy from DTO fields. */
export function mapContentResult<T extends object>(value: T, ...inputs: unknown[]): T {
  const existing = ownedContentResult(value);
  const policies: ContentPolicy[] = [...existing?.policies ?? exposedPolicies(value) ?? []];
  const identities: ContentIdentity[] = [...existing?.identities ?? []];
  let owner=!!existing;
  for (const input of inputs) {
    const result = ownedContentResult(input);
    owner ||= !!result;
    policies.push(...result?.policies ?? exposedPolicies(input) ?? []);
    identities.push(...result?.identities ?? []);
  }
  const sources = exposedSourcePolicies(value) ?? inputs.map(exposedSourcePolicies).find(Boolean);
  if(!owner && inputs.length) return policies.length || sources ? exposeContent(value,policies,sources) : value;
  const mapped = contentResult(value, policies, identities);
  return sources ? exposeContent(mapped, policies, sources) : mapped;
}
