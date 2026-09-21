import { CapabilityError } from './capabilities/errors';

export function strictBooleanQueryParam(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new CapabilityError('INVALID', `O parâmetro ${name} deve aparecer uma vez e ser "true" ou "false".`);
}
