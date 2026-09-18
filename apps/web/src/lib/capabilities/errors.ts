export const capabilityErrorCodes = ['UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'SCOPE_REQUIRED', 'NOT_READY', 'RATE_LIMITED', 'INVALID', 'APPROVAL_REQUIRED'] as const;
export type CapabilityErrorCode = typeof capabilityErrorCodes[number];

/** Domain failure with a stable code, shared by the UI, the HTTP routes and the agent tools. */
export class CapabilityError extends Error {
  constructor(public readonly code: CapabilityErrorCode, message: string) { super(message); }
}

const statuses: Record<CapabilityErrorCode, number> = {
  UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409,
  SCOPE_REQUIRED: 422, NOT_READY: 409, RATE_LIMITED: 429, INVALID: 400,
  APPROVAL_REQUIRED: 428,
};

export function statusForCapabilityError(error: CapabilityError) { return statuses[error.code] ?? 500; }
